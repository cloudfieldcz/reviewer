import type { RewriteContext } from './rewrite';

/**
 * Small script appended to every proxied HTML page. Keeps navigation inside the proxy and tells the
 * parent (review screen) about client-side route changes. Everything else – overlay, markers – is
 * driven by the parent directly through the same-origin iframe DOM.
 */
export function injectScript(ctx: RewriteContext): string {
  const cfg = JSON.stringify({
    baseUrl: ctx.baseUrl,
    projectId: ctx.projectId,
    publicOrigin: ctx.publicOrigin,
  });
  return `(function(){
var CFG=${cfg};
var PREFIX='/p/'+CFG.projectId;
var base=new URL(CFG.baseUrl);
var basePath=base.pathname.replace(/\\/$/,'');
document.documentElement.setAttribute('data-reviewer','1');

function toProxy(href){
  try{var u=new URL(href,document.baseURI);}catch(e){return null;}
  if(u.protocol!=='http:'&&u.protocol!=='https:')return null;
  if(u.host===location.host&&u.pathname.indexOf(PREFIX+'/')===0)return u.href;
  if(u.host===location.host&&u.pathname===PREFIX)return u.href;
  if(u.host!==base.host)return null;
  if(basePath&&u.pathname!==basePath&&u.pathname.indexOf(basePath+'/')!==0)return null;
  var rest=u.pathname.slice(basePath.length)||'/';
  return CFG.publicOrigin+PREFIX+rest+u.search+u.hash;
}
function pagePath(){
  var p=location.pathname.replace(new RegExp('^'+PREFIX.replace(/[/]/g,'\\\\/')+'(?=/|$)'),'')||'/';
  return p+location.search;
}
function notify(){
  try{if(window.parent&&window.parent!==window)window.parent.postMessage({type:'reviewer:navigate',path:pagePath()},location.origin);}catch(e){}
}
// history API: keep the /p/{id} prefix when a client-side router pushes a bare path.
['pushState','replaceState'].forEach(function(m){
  var orig=history[m];
  history[m]=function(state,title,url){
    if(url!=null){
      var mapped=toProxy(String(url));
      if(mapped)url=mapped;
    }
    var r=orig.call(this,state,title,url);
    notify();
    return r;
  };
});
window.addEventListener('popstate',notify);
window.addEventListener('hashchange',notify);

// Clicks on links (including ones created after load): route through the proxy.
document.addEventListener('click',function(ev){
  if(ev.defaultPrevented||ev.button!==0||ev.metaKey||ev.ctrlKey||ev.shiftKey||ev.altKey)return;
  var a=ev.target&&ev.target.closest?ev.target.closest('a[href]'):null;
  if(!a)return;
  var href=a.getAttribute('href')||'';
  if(!href||href.charAt(0)==='#'||/^(javascript|mailto|tel|sms|data):/i.test(href))return;
  var mapped=toProxy(href);
  if(mapped){
    if(a.target==='_blank')return;
    ev.preventDefault();
    location.href=mapped;
  }else{
    a.target='_blank';a.rel='noopener noreferrer';
  }
},true);

// Forms: GET forms are proxied, everything else opens against the original site in a new tab.
document.addEventListener('submit',function(ev){
  var f=ev.target;if(!f||!f.action)return;
  var mapped=toProxy(f.getAttribute('action')||location.href);
  if(mapped){f.action=mapped;}else{f.target='_blank';}
},true);

notify();
})();`;
}
