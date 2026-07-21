/*global Ultraviolet*/
self.__uv$config = {
    prefix: '/service/',
    bare: '/bare/',
    encodeUrl: Ultraviolet.codec.xor.encode,
    decodeUrl: Ultraviolet.codec.xor.decode,
    handler: '/uv/uv.handler.js',
    client: '/uv/uv.client.js',
    bundle: '/uv/uv.bundle.js',
    config: '/uv/uv.config.js',
    inject: [{
        host: '.*',
        injectTo: 'head',
        html: '<script>(function(){if(window.__ORBIT_NAV_BRIDGE__)return;window.__ORBIT_NAV_BRIDGE__=true;var realWindow=globalThis;function parentWindow(){return realWindow["par"+"ent"]}function topWindow(){return realWindow["to"+"p"]}function send(url,target,kind){if(!url||/^javascript:/i.test(String(url)))return false;var parent=parentWindow();if(!parent||parent===realWindow)return false;parent["post"+"Message"]({type:"ORBIT_PROXY_NAVIGATION",url:String(url),target:String(target||""),kind:String(kind||"navigation")},"*");return true}function shouldRouteTarget(target){target=String(target||"").toLowerCase();if(target==="_blank"||target==="_top")return true;if(target==="_parent")return parentWindow()===topWindow();return false}document.addEventListener("click",function(event){var anchor=event.target&&event.target.closest&&event.target.closest("a[href]");if(!anchor)return;if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;var target=anchor.getAttribute("target")||"";if(!shouldRouteTarget(target))return;if(send(anchor.href,target,"anchor"))event.preventDefault()},true);var nativeOpen=window.open;window.open=function(url,target,features){target=target||"_blank";if(shouldRouteTarget(target)&&send(url,target,"window.open"))return null;return nativeOpen?nativeOpen.apply(window,arguments):null}})();</script>'
    }],
    sw: '/uv/uv.sw.js',
    // This UV build rewrites dynamic import() as __uv.rewriteImport(base, specifier),
    // while the bundled runtime's default method expects (specifier, base).
    // Keep imports resolving to the requested module instead of the current document.
    rewriteImport: function(base, specifier, meta) {
        return this.rewriteUrl(specifier, { ...(meta || this.meta), base: base });
    },
};
