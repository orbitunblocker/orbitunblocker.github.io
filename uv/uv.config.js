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
    sw: '/uv/uv.sw.js',
    // This UV build rewrites dynamic import() as __uv.rewriteImport(base, specifier),
    // while the bundled runtime's default method expects (specifier, base).
    // Keep imports resolving to the requested module instead of the current document.
    rewriteImport: function(base, specifier, meta) {
        return this.rewriteUrl(specifier, { ...(meta || this.meta), base: base });
    },
};
