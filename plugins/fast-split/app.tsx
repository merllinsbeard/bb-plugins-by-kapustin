import {definePluginApp} from '@get-bb/plugin-sdk/app';
import {toast} from 'sonner';
export function openSplit(documentRoot:Document=document){
 if(window.matchMedia('(max-width: 767px)').matches){toast.info('Splits are available on wide layouts.');return;}
 const candidates=documentRoot.querySelectorAll<HTMLButtonElement>('[data-sidebar-navigation-item="new-thread"] button, button[aria-label^="New thread"]');
 const target=Array.from(candidates).find(button=>!button.disabled && button.getClientRects().length>0);
 if(!target){toast.error('Show the New thread sidebar action to create a split.');return;}
 if(documentRoot.querySelectorAll('[data-split-pane-id]').length>=8){toast.info('Pane limit reached. Close an unlocked pane first.');return;}
 target.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,ctrlKey:true,metaKey:true,view:window}));
}
export default definePluginApp(app=>{app.experimental_sidebarFooter.register({kind:'action',id:'split',label:'Fast Split',icon:'Columns2',onActivate:()=>openSplit()});});
