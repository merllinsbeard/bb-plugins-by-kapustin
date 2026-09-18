import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { connectGraph, graphLayers, type GraphEdge, type GraphNodeShape } from "./shared";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { usePortalScopeProps } from "./lib/portal-scope";

export interface CanvasNodeMeta {
  dot?: string;
  subtitle?: string;
  status?: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  badge?: ReactNode;
}
type Point = { x: number; y: number };
type LinkDraft = { fixed: string; end: "source" | "target"; original?: GraphEdge };
type Gesture = { kind: "node"; id: string; start: Point; origin: Point; moved: boolean; pointerId: number }
  | { kind: "pan"; start: Point; origin: Point; moved: boolean; pointerId: number }
  | { kind: "link"; draft: LinkDraft; start: Point; moved: boolean; pointerId: number };
interface Props {
  nodes: GraphNodeShape[];
  meta: (node: GraphNodeShape) => CanvasNodeMeta;
  roles?: Array<{ slug: string; name: string }>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  edit?: {
    onAddAfter: (id: string) => void;
    onAddRoot: (roleSlug?: string) => void;
    onToggleEdge: (source: string, target: string) => void;
    onConnect: (source: string, target: string, previous?: GraphEdge) => boolean;
    onDelete: (id: string) => void;
    onDuplicate?: (id: string) => void;
    onMove?: (id: string, position: Point) => void;
    onArrange?: () => void;
  };
  error?: string | null;
  className?: string;
}
const W = 224, H = 130, PAD = 40;
const MIN_ZOOM = .05, MAX_ZOOM = 4;
const curve = (a: Point, b: Point) => {
  const dx = Math.max(55, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
};
const actionCls = "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-40";

/** Both mouse and touch use pointer events; keyboard users can click the two ports. */
export function GraphCanvas({ nodes, meta, roles = [], selectedId, onSelect, edit, error, className }: Props) {
  const portalScope = usePortalScopeProps();
  const markerId = useId().replace(/:/g, "");
  const viewport = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [role, setRole] = useState("");
  const [link, setLink] = useState<LinkDraft | null>(null);
  const [candidate, setCandidate] = useState<{ id: string; valid: boolean } | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [edge, setEdge] = useState<{ source: string; target: string } | null>(null);
  const [moving, setMoving] = useState<{ id: string; position: Point } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const layout = useMemo(() => {
    let depth = new Map<string, number>();
    let problem: string | null = null;
    try { depth = graphLayers(nodes); } catch (cause) { problem = String(cause); }
    const rows = new Map<number, number>();
    const positions = new Map<string, Point>();
    for (const n of nodes) {
      const col = depth.get(n.id) ?? 0;
      const row = rows.get(col) ?? 0; rows.set(col, row + 1);
      positions.set(n.id, n.position ?? { x: PAD + col * 320, y: PAD + row * 180 });
    }
    return { positions, problem };
  }, [nodes]);
  const positions = new Map(layout.positions);
  if (moving) positions.set(moving.id, moving.position);
  const width = Math.max(650, ...[...positions.values()].map((p) => p.x + W + 90));
  const height = Math.max(360, ...[...positions.values()].map((p) => p.y + H + PAD));
  const local = (clientX: number, clientY: number): Point => {
    const rect = surface.current!.getBoundingClientRect();
    return { x: (clientX - rect.left) / zoom, y: (clientY - rect.top) / zoom };
  };
  const connection = (draft: LinkDraft, id: string): GraphEdge => draft.end === "target"
    ? { source: draft.fixed, target: id } : { source: id, target: draft.fixed };
  const canConnect = (draft: LinkDraft, id: string): boolean => {
    try { connectGraph(nodes, connection(draft, id), draft.original); return true; } catch { return false; }
  };
  const resetLink = () => { setLink(null); setPointer(null); setCandidate(null); };
  const release = () => {
    const g = gesture.current; gesture.current = null;
    if (g && surface.current?.hasPointerCapture(g.pointerId)) surface.current.releasePointerCapture(g.pointerId);
  };
  const cancelGesture = () => { release(); setPanning(false); setMoving(null); resetLink(); };
  useEffect(() => {
    if (!link && !moving && !panning) return;
    const cancel = () => { release(); setPanning(false); setMoving(null); setLink(null); setPointer(null); setCandidate(null); };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape, true); };
  }, [link, moving, panning]);
  const commit = (draft: LinkDraft, id: string) => {
    const next = connection(draft, id);
    if (edit?.onConnect(next.source, next.target, draft.original)) setEdge(next);
    resetLink();
  };
  const connect = (id: string) => { if (link) commit(link, id); };
  const hitNode = (x: number, y: number, draft: LinkDraft): string | null => {
    const v = viewport.current!.getBoundingClientRect();
    if (x < v.left || x > v.right || y < v.top || y > v.bottom) return null;
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-node-id]");
    if (el && surface.current?.contains(el)) return el.dataset.nodeId ?? null;
    // Snap near the appropriate port, including when zoomed out or using a finger.
    let nearest: string | null = null, distance = 24;
    for (const n of nodes) {
      const pos = positions.get(n.id)!;
      const port = { x: pos.x + (draft.end === "source" ? W : 0), y: pos.y + H / 2 };
      const rect = surface.current!.getBoundingClientRect();
      const d = Math.hypot(x - rect.left - port.x * zoom, y - rect.top - port.y * zoom);
      if (d < distance) { distance = d; nearest = n.id; }
    }
    return nearest;
  };
  const capture = (e: PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    surface.current!.setPointerCapture(e.pointerId);
  };
  const beginLink = (e: PointerEvent, draft: LinkDraft) => {
    if (!edit || e.button !== 0 || gesture.current) return;
    capture(e);
    const start = local(e.clientX, e.clientY);
    gesture.current = { kind: "link", draft, start, moved: false, pointerId: e.pointerId };
    setLink(draft); setPointer(start); setCandidate(null);
    if (draft.original) { setEdge(draft.original); onSelect?.(null); }
  };
  const begin = (e: PointerEvent, id: string) => {
    if (!edit || e.button !== 0 || link || gesture.current) return;
    capture(e);
    gesture.current = { kind: "node", id, start: local(e.clientX, e.clientY), origin: positions.get(id)!, moved: false, pointerId: e.pointerId };
  };
  const beginPan = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || gesture.current || link) return;
    if ((e.target as Element).closest("[data-node-id],button,path,circle")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Leave native scrollbars and the resize handle available.
    if (e.clientX >= rect.left + e.currentTarget.clientWidth || e.clientY >= rect.top + e.currentTarget.clientHeight - 16) return;
    capture(e);
    gesture.current = { kind: "pan", start: { x: e.clientX, y: e.clientY }, origin: pan, moved: false, pointerId: e.pointerId };
    setPanning(true);
  };
  const beginEdge = (e: PointerEvent, original: GraphEdge, end?: "source" | "target") => {
    const side = end ?? "target";
    beginLink(e, { fixed: side === "target" ? original.source : original.target, end: side, original });
  };
  const nodePosition = (g: Extract<Gesture, { kind: "node" }>, p: Point): Point => ({
    x: Math.min(10000, Math.max(16, g.origin.x + p.x - g.start.x)),
    y: Math.min(10000, Math.max(16, g.origin.y + p.y - g.start.y)),
  });
  const move = (e: PointerEvent) => {
    const g = gesture.current;
    if (g && g.pointerId !== e.pointerId) return;
    if (g?.kind === "pan") {
      const dx = e.clientX - g.start.x, dy = e.clientY - g.start.y;
      if (g.moved || Math.hypot(dx, dy) >= 3) {
        g.moved = true;
        setPan({ x: g.origin.x + dx, y: g.origin.y + dy });
      }
      return;
    }
    const p = local(e.clientX, e.clientY);
    if (g && (Math.hypot(p.x - g.start.x, p.y - g.start.y) * zoom >= 3 || g.moved)) {
      g.moved = true;
      if (g.kind === "node") { setMoving({ id: g.id, position: nodePosition(g, p) }); return; }
    }
    const draft = g?.kind === "link" ? g.draft : link;
    if (draft) {
      const id = hitNode(e.clientX, e.clientY, draft);
      setCandidate(id ? { id, valid: canConnect(draft, id) } : null);
      setPointer(p);
    }
  };
  const finish = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    release();
    // Capture is on the stable canvas, so browsers target the following click there.
    // Handle taps here; suppress only that synthesized click (never the next gesture).
    suppressClick.current = true;
    if (g.kind === "pan") {
      setPanning(false);
      if (!g.moved) { onSelect?.(null); setEdge(null); }
    } else if (g.kind === "node") {
      if (g.moved) edit?.onMove?.(g.id, nodePosition(g, local(e.clientX, e.clientY)));
      else { onSelect?.(g.id); setEdge(null); }
    } else if (g.moved) {
      const id = hitNode(e.clientX, e.clientY, g.draft);
      if (id) commit(g.draft, id); else resetLink();
    } else if (g.draft.original) {
      setEdge(g.draft.original); resetLink();
    } else {
      setLink(g.draft); setPointer(null);
    }
    setMoving(null);
  };
  const removeEdge = () => {
    if (edge) edit?.onToggleEdge(edge.source, edge.target);
    setEdge(null);
  };
  const fit = () => {
    const v = viewport.current;
    if (v) { setPan({ x: 0, y: 0 }); setZoom(Math.max(MIN_ZOOM, Math.min(1, (v.clientWidth - 20) / width, (v.clientHeight - 20) / height))); v.scrollTo(0, 0); }
  };
  const shownError = error ?? layout.problem;
  return (
    <section className={cn("min-w-0", className)} aria-label="Workflow canvas" onKeyDown={(e) => {
      if ((e.target as HTMLElement).matches("input,textarea,select,[contenteditable=true]")) return;
      if (e.key === "Escape" && (link || gesture.current)) { e.preventDefault(); e.stopPropagation(); cancelGesture(); }
      if (edit && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        if (edge) removeEdge(); else if (selectedId) edit.onDelete(selectedId);
      }
    }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {edit ? <>
          <select aria-label="Agent for new step" className="max-w-40 rounded-md border border-border bg-background px-2 py-1.5 text-xs" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Choose agent…</option>
            {roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
          </select>
          <button type="button" className={actionCls} disabled={nodes.length >= 40 || roles.length === 0} onClick={() => edit.onAddRoot(role || roles[0]?.slug)}><Icon name="Plus" className="size-3.5" /> Add step</button>
          <button type="button" className={actionCls} onClick={() => { edit.onArrange?.(); viewport.current?.scrollTo(0, 0); }}>Auto layout</button>
        </> : null}
        <span className="flex-1" />
        <button type="button" className={actionCls} aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))}>−</button>
        <input type="range" aria-label="Canvas zoom" min={MIN_ZOOM * 100} max={MAX_ZOOM * 100} step={1} value={Math.round(zoom * 100)} className="w-24 accent-primary sm:w-32" onChange={(e) => setZoom(Number(e.target.value) / 100)} />
        <button type="button" className={cn(actionCls, "min-w-14 justify-center tabular-nums")} title="Reset zoom to 100%" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
        <button type="button" className={actionCls} aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))}>+</button>
        <button type="button" className={actionCls} onClick={fit}>Fit</button>
      </div>
      {shownError ? <p role="alert" className="mb-2 text-xs text-destructive">{shownError}</p> : null}
      <div ref={viewport} tabIndex={0} aria-label="Graph workspace" onPointerDown={beginPan}
        onPointerDownCapture={() => { suppressClick.current = false; }}
        onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture}
        onClickCapture={(e) => { if (suppressClick.current && e.detail !== 0) { suppressClick.current = false; e.preventDefault(); e.stopPropagation(); } }}
        className={cn(panning ? "cursor-grabbing" : "cursor-grab", "relative min-h-[260px] touch-none overflow-auto rounded-xl border border-border bg-muted/20 outline-none focus-visible:ring-2 focus-visible:ring-ring", edit ? "h-[62dvh] max-h-[80dvh] resize-y" : "h-[42dvh] max-h-[440px]")}>
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div ref={surface} className="relative origin-top-left" style={{ width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, backgroundImage: "radial-gradient(var(--border) 1px, transparent 1px)", backgroundSize: "20px 20px" }}
            onLostPointerCapture={() => { if (gesture.current) cancelGesture(); }}
            onClick={(e) => { if (e.target === e.currentTarget) { onSelect?.(null); setEdge(null); cancelGesture(); } }}>
            <svg width={width} height={height} className="pointer-events-none absolute inset-0 z-10 overflow-visible">
              <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
              {nodes.flatMap((n) => n.inputs.map((source) => {
                const a = positions.get(source), b = positions.get(n.id);
                if (!a || !b) return null;
                const selected = edge?.source === source && edge.target === n.id;
                const d = curve({ x: a.x + W, y: a.y + H / 2 }, { x: b.x, y: b.y + H / 2 });
                const reconnecting = link?.original?.source === source && link.original.target === n.id;
                const original = { source, target: n.id };
                return <g key={`${source}/${n.id}`}>
                  <path d={d} fill="none" stroke="currentColor" strokeWidth={selected ? 3 : 1.75} markerEnd={`url(#${markerId})`} className={cn(selected ? "text-primary" : "text-muted-foreground/60", reconnecting && "opacity-25")} />
                  {edit ? <path d={d} fill="none" stroke="transparent" strokeWidth={24} className="pointer-events-auto touch-none cursor-grab active:cursor-grabbing" role="button" tabIndex={0} aria-label={`Connection ${nodes.find((x) => x.id === source)?.label} to ${n.label}`} onPointerDown={(e) => beginEdge(e, original)} onClick={() => { setEdge(original); onSelect?.(null); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEdge({ source, target: n.id }); onSelect?.(null); } }} /> : null}
                  {edit && selected ? (["source", "target"] as const).map((end) => {
                    const cx = end === "source" ? a.x + W + 24 : b.x - 24;
                    const cy = (end === "source" ? a.y : b.y) + H / 2;
                    return <g key={end}>
                      <circle cx={cx} cy={cy} r={6 / Math.max(.6, zoom)} className="fill-background stroke-primary" strokeWidth={2} />
                      <circle cx={cx} cy={cy} r={16 / zoom} fill="transparent" className="pointer-events-auto touch-none cursor-grab active:cursor-grabbing" role="button" tabIndex={0}
                        aria-label={`Move ${end} of connection ${source} to ${n.id}`}
                        onPointerDown={(e) => beginEdge(e, original, end)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setLink({ fixed: end === "target" ? source : n.id, end, original }); setPointer(null); } }} />
                    </g>;
                  }) : null}
                </g>;
              }))}
              {link && pointer && positions.has(link.fixed) ? (() => {
                const fixed = positions.get(link.fixed)!;
                const snap = candidate?.valid ? positions.get(candidate.id) : null;
                const loose = snap ? { x: snap.x + (link.end === "source" ? W : 0), y: snap.y + H / 2 } : pointer;
                const a = link.end === "target" ? { x: fixed.x + W, y: fixed.y + H / 2 } : loose;
                const b = link.end === "source" ? { x: fixed.x, y: fixed.y + H / 2 } : loose;
                return <path data-connection-preview d={curve(a, b)} fill="none" stroke="currentColor" strokeWidth={2.5} strokeDasharray="6 4" markerEnd={`url(#${markerId})`} className={candidate && !candidate.valid ? "text-destructive" : "text-primary"} />;
              })() : null}
            </svg>
            {nodes.map((n) => {
              const p = positions.get(n.id)!, m = meta(n);
              return <ContextMenu.Root key={n.id} onOpenChange={(open) => {
                if (open) { cancelGesture(); setEdge(null); onSelect?.(n.id); }
              }}>
                <ContextMenu.Trigger asChild disabled={!edit}>
                <div data-node-id={n.id} className={cn("absolute z-20 rounded-xl border bg-background shadow-sm", selectedId === n.id ? "border-primary ring-2 ring-primary/25" : "border-border", link?.fixed === n.id && "ring-2 ring-primary", candidate?.id === n.id && (candidate.valid ? "ring-4 ring-primary/40" : "ring-4 ring-destructive/40"), m.status === "failed" && "border-destructive", m.status === "running" && "border-primary", m.status === "succeeded" && "border-emerald-500")} style={{ left: p.x, top: p.y, width: W, height: H }}>
                <button type="button" aria-label={`Edit step ${n.label}`} className={cn("flex h-full w-full flex-col overflow-hidden rounded-xl px-4 py-3 text-left", edit && "touch-none cursor-grab active:cursor-grabbing")} onPointerDown={(e) => begin(e, n.id)} onClick={() => {
                  if (link) connect(n.id); else { onSelect?.(n.id); setEdge(null); }
                }}>
                  <span className="flex w-full items-center gap-2"><span className={cn("size-2 shrink-0 rounded-full", m.dot ?? "bg-muted-foreground")} /><span className="truncate text-sm font-medium">{n.label}</span>{n.final ? <Icon name="Star" className="size-3.5 text-amber-500" /> : null}{m.badge}</span>
                  <span className="mt-1 w-full truncate text-xs text-muted-foreground">{m.subtitle ?? n.roleSlug}</span>
                  <span className="mt-2 line-clamp-2 whitespace-pre-wrap font-mono text-[10px] text-muted-foreground">{n.prompt}</span>
                </button>
                {edit ? <>
                  <button type="button" data-port="input" aria-label={`Input of ${n.label}`} title={n.inputs.length === 1 ? "Drag to move the incoming connection" : "Drag to connect, or drop an output here"}
                    className="absolute -left-4 top-1/2 flex size-8 -translate-y-1/2 touch-none items-center justify-center rounded-full cursor-crosshair"
                    onPointerDown={(e) => {
                      if (link) return;
                      if (n.inputs.length === 1) beginEdge(e, { source: n.inputs[0]!, target: n.id }, "target");
                      else beginLink(e, { fixed: n.id, end: "source" });
                    }} onClick={() => { if (link) connect(n.id); else setLink({ fixed: n.id, end: "source" }); }}>
                    <span className={cn("pointer-events-none size-4 rounded-full border-2 border-primary bg-background", link && "ring-4 ring-primary/20")} />
                  </button>
                  <button type="button" data-port="output" aria-label={`Output of ${n.label}`} title="Drag to another step to connect"
                    className="absolute -right-4 top-1/2 flex size-8 -translate-y-1/2 touch-none items-center justify-center rounded-full cursor-crosshair"
                    onPointerDown={(e) => { if (!link) beginLink(e, { fixed: n.id, end: "target" }); }}
                    onClick={() => { if (link) connect(n.id); else { setLink({ fixed: n.id, end: "target" }); setPointer(null); } }}>
                    <span className="pointer-events-none size-4 rounded-full border-2 border-primary bg-primary" />
                  </button>
                  <button type="button" aria-label={`Add step after ${n.label}`} className="absolute -right-3 -top-3 flex size-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-primary" disabled={nodes.length >= 40} onClick={() => edit.onAddAfter(n.id)}>+</button>
                </> : null}
              </div>
                </ContextMenu.Trigger>
                {edit ? <ContextMenu.Portal>
                  <ContextMenu.Content {...portalScope} className="z-[100] min-w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md" onKeyDown={(e) => e.stopPropagation()}>
                    <ContextMenu.Item className="flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive outline-none focus:bg-muted" onSelect={() => { cancelGesture(); setEdge(null); edit.onDelete(n.id); }}>
                      <Icon name="Trash2" className="size-4" /> Delete step
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal> : null}
              </ContextMenu.Root>;
            })}
            {!nodes.length ? <div className="absolute left-10 top-10 text-sm text-muted-foreground">Add your first step to begin.</div> : null}
          </div>
        </div>
      </div>
      {edit ? <div className="mt-3 flex min-h-8 flex-wrap items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
        {link ? <><span>{candidate && !candidate.valid ? "This connection would create a cycle or exceed the input limit." : `Choose a ${link.end === "target" ? "destination" : "source"} step. Drop outside to cancel.`}</span><button type="button" className={actionCls} onClick={cancelGesture}>Cancel connection</button></> : edge ? <><span>{nodes.find((n) => n.id === edge.source)?.label} → {nodes.find((n) => n.id === edge.target)?.label}</span><button type="button" className={actionCls} onClick={removeEdge}>Remove connection</button></> : selectedId ? <><button type="button" className={actionCls} disabled={nodes.length >= 40} onClick={() => edit.onDuplicate?.(selectedId)}>Duplicate step</button><button type="button" className={cn(actionCls, "text-destructive")} onClick={() => edit.onDelete(selectedId)}>Delete step</button></> : <span>Drag ● to connect · drag an arrow to reconnect · select a line to move either end or delete it.</span>}
      </div> : null}
    </section>
  );
}
