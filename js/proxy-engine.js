/**
 * Helios Proxy Engine - Modular Core
 * Extracted proxy/browser engine functionality from Helios
 * 
 * This module contains only the core proxy functionality:
 * - Multi-proxy fallback system
 * - Encryption/Decryption (AES-GCM)
 * - Shadow DOM content isolation
 * - URL rewriting and resource injection
 * - Script execution
 * - Font fixing
 * - HTML sanitization
 * 
 * Dependencies: None (uses built-in Web Crypto API, DOMParser, URL API)
 * 
 * Usage:
 *   const proxyEngine = new ProxyEngine();
 *   await proxyEngine.loadUrl('https://example.com', contentContainer);
 */

class ProxyEngine {
  constructor(options = {}) {
    this.proxies = options.proxies || [
      `https://api.cors.lol/?url=`,
      `https://api.codetabs.com/v1/proxy?quest=`,
      `https://api.codetabs.com/v1/tmp/?quest=`,
      `https://api.allorigins.win/raw?url=`
    ];
    this.timeout = options.timeout || 10000;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    this.encryptionEnabled = options.encryptionEnabled !== false;
    this.key = null;
  }

  /**
   * Initialize the proxy engine (generates encryption key if enabled)
   */
  async init() {
    if (this.encryptionEnabled) {
      this.key = await this.generateKey();
    }
  }

  /**
   * Load a URL through the proxy system
   * @param {string} url - The URL to load
   * @param {HTMLElement} contentContainer - The DOM element to inject content into
   * @param {object} options - Additional options
   * @returns {Promise<void>}
   */
  async loadUrl(url, contentContainer, options = {}) {
    const { 
      onLoadingStart, 
      onLoadingComplete, 
      onError,
      onTitleChange
    } = options;

    if (onLoadingStart) onLoadingStart();

    try {
      const htmlText = await this.fetchWithMultiProxy(url);
      
      if (!htmlText) {
        throw new Error('Failed to fetch content from all proxies');
      }

      // Sanitize the HTML
      const sanitizedHtml = this.sanitizeHtmlText(htmlText);
      
      // Fix fonts
      const fontFixedHtml = await this.fixFontsInFetchedContent(sanitizedHtml, url);
      
      // Execute scripts
      const scriptExecutedHtml = this.executeScriptsFromContent(fontFixedHtml);
      
      // Parse and extract title
      const parser = new DOMParser();
      const doc = parser.parseFromString(scriptExecutedHtml, 'text/html');
      const title = doc.title || 'Untitled';
      
      if (onTitleChange) onTitleChange(title);

      // Create Shadow DOM container
      const shadowContainer = this.createShadowDOMContainer(scriptExecutedHtml, url);
      
      // Clear and inject content
      contentContainer.innerHTML = '';
      contentContainer.appendChild(shadowContainer);

      if (onLoadingComplete) onLoadingComplete();

    } catch (error) {
      console.error('Proxy engine error:', error);
      if (onError) onError(error);
    }
  }

  /**
   * Fetch content with multi-proxy fallback
   * @param {string} url - The URL to fetch
   * @returns {Promise<string>} The HTML content
   */
  async fetchWithMultiProxy(url) {
    // Remove cors.lol proxy for Google URLs
    const proxies = url.includes('google.com') 
      ? this.proxies.filter(p => !p.includes('cors.lol'))
      : this.proxies;

    const errors = [];

    for (const proxy of proxies) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const proxyUrl = proxy + encodeURIComponent(url);
        console.log(`Attempting to fetch with proxy: ${proxy}`);

        const response = await fetch(proxyUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent
          }
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const encryptedResponse = await response.text();
        
        // Decrypt if encryption is enabled
        let htmlText;
        if (this.encryptionEnabled) {
          try {
            const encryptedData = JSON.parse(encryptedResponse);
            htmlText = await this.decryptData(encryptedData, this.key);
          } catch (e) {
            // If decryption fails, use raw response (some proxies don't encrypt)
            htmlText = encryptedResponse;
          }
        } else {
          htmlText = encryptedResponse;
        }

        console.log(`Fetch successful using proxy: ${proxy}`);
        return htmlText;

      } catch (error) {
        console.error(`Error with proxy ${proxy}: ${error.message}`);
        errors.push(`${proxy}: ${error.message}`);
        continue;
      }
    }

    throw new Error(`Failed to fetch content from all proxies. Errors: ${errors.join(', ')}`);
  }

  /**
   * Generate cryptographic key for encryption
   * @returns {Promise<CryptoKey>}
   */
  async generateKey() {
    return await window.crypto.subtle.generateKey({
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
  }

  /**
   * Encrypt data with AES-GCM
   * @param {string} data - Data to encrypt
   * @param {CryptoKey} key - Encryption key
   * @returns {Promise<object>} Encrypted data with IV
   */
  async encryptData(data, key) {
    const encodedData = new TextEncoder().encode(data);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encryptedData = await window.crypto.subtle.encrypt({
      name: "AES-GCM",
      iv: iv
    },
    key,
    encodedData
    );
    return {
      iv: Array.from(iv),
      encryptedData: Array.from(new Uint8Array(encryptedData))
    };
  }

  /**
   * Decrypt data with AES-GCM
   * @param {object} encryptedObj - Encrypted data object with iv and encryptedData
   * @param {CryptoKey} key - Decryption key
   * @returns {Promise<string>} Decrypted data
   */
  async decryptData(encryptedObj, key) {
    const decryptedData = await window.crypto.subtle.decrypt({
      name: "AES-GCM",
      iv: new Uint8Array(encryptedObj.iv)
    },
    key,
    new Uint8Array(encryptedObj.encryptedData)
    );
    return new TextDecoder().decode(decryptedData);
  }

  /**
   * Sanitize HTML text to fix encoding issues
   * @param {string} htmlText - HTML text to sanitize
   * @returns {string} Sanitized HTML
   */
  sanitizeHtmlText(htmlText) {
    // Fix encoding issues with replacement character
    htmlText = htmlText.replace(/([a-z])\uFFFD([A-Z])/g, '$1 $2');
    htmlText = htmlText.replace(/\uFFFD/g, 'é');
    
    // Translate French redirection notices
    htmlText = htmlText.replace(/Avertissement de redirection/g, 'Redirect Notice');
    htmlText = htmlText.replace(/La page que vous consultiez essaie de vous rediriger vers/g, 'The page you were on is trying to send you to');
    htmlText = htmlText.replace(/Si\s+vous\s+ne\s+souhaitez\s+pas\s+consulter\s+Cette\s+page/i, 'If you do not want to visit that page');
    htmlText = htmlText.replace(/vous\s* pouvez\s*revenir\s*à\s*la\s*page\s*précédente\./i, 'you can return to the previous page.');
    
    return htmlText;
  }

  /**
   * Execute scripts from content
   * @param {string} content - HTML content
   * @returns {string} Content without original script tags
   */
  executeScriptsFromContent(content) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const scripts = tempDiv.getElementsByTagName('script');

    Array.from(scripts).forEach(script => {
      const newScript = document.createElement('script');
      if (script.src) {
        newScript.src = script.src;
      } else {
        newScript.textContent = script.textContent;
      }
      Array.from(script.attributes).forEach(attr => {
        if (attr.name !== 'src') {
          newScript.setAttribute(attr.name, attr.value);
        }
      });
      document.head.appendChild(newScript);
    });

    return tempDiv.innerHTML;
  }

  /**
   * Fix fonts in fetched content
   * @param {string} htmlContent - HTML content
   * @param {string} baseUrl - Base URL for resolving relative paths
   * @returns {Promise<string>} HTML with fixed fonts
   */
  async fixFontsInFetchedContent(htmlContent, baseUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    const stylesheets = doc.querySelectorAll('link[rel="stylesheet"]');

    async function fetchAndParseCss(url) {
      try {
        const response = await fetch(url);
        return await response.text();
      } catch (e) {
        console.warn('Could not fetch CSS:', url, e);
        return '';
      }
    }

    function extractFontFaceRules(css) {
      const fontFaceRegex = /@font-face\s*{[^}]*}/g;
      return css.match(fontFaceRegex) || [];
    }

    function modifyFontUrls(css, baseUrl) {
      return css.replace(/url\(['"]?(.+?)['"]?\)/g, (match, url) => {
        if (!url.startsWith('http')) {
          return `url("${new URL(url, baseUrl)}")`;
        }
        return match;
      });
    }

    const results = await Promise.all(Array.from(stylesheets).map(async link => {
      const href = new URL(link.getAttribute('href'), baseUrl).href;
      try {
        const css = await fetchAndParseCss(href);
        const fontFaceRules = extractFontFaceRules(css);
        return fontFaceRules.map(rule => modifyFontUrls(rule, href));
      } catch (e) {
        return [];
      }
    }));

    const allFontFaceRules = results.flat();
    const styleElement = doc.createElement('style');
    styleElement.textContent = allFontFaceRules.join('\n');
    doc.head.appendChild(styleElement);

    return new XMLSerializer().serializeToString(doc);
  }

  /**
   * Create Shadow DOM container with content isolation
   * @param {string} htmlContent - HTML content to inject
   * @param {string} baseUrl - Base URL for resolving relative paths
   * @returns {HTMLElement} Shadow DOM container
   */
  createShadowDOMContainer(htmlContent, baseUrl) {
    const shadowContainer = document.createElement('div');
    shadowContainer.style.position = 'relative';
    shadowContainer.style.width = '100%';
    shadowContainer.style.height = '100%';
    shadowContainer.style.overflow = 'auto';
    shadowContainer.style.border = 'none';

    const shadowRoot = shadowContainer.attachShadow({ mode: 'open' });

    // Add default style to prevent conflicts
    const defaultStyle = document.createElement('style');
    defaultStyle.textContent = `
      :host {
        all: initial;
        background-color: #fff !important;
        font-family: Arial, sans-serif;
      }
    `;
    shadowRoot.appendChild(defaultStyle);

    // Parse HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');
    
    // Rewrite relative URLs to absolute URLs
    const base = new URL(baseUrl);
    
    // Rewrite all resource URLs
    const elements = shadowRoot.querySelectorAll('a[href], link[href], script[src], img[src], video[src], audio[src], source[src]');
    elements.forEach(element => {
      const attributeName = element.hasAttribute('href') ? 'href' : 'src';
      try {
        element.setAttribute(attributeName, new URL(element.getAttribute(attributeName), base).href);
      } catch (e) {
        console.error('Error rewriting URL:', e);
      }
    });

    shadowRoot.innerHTML = this.sanitizeHtmlText(doc.documentElement.outerHTML);

    // Intercept link clicks to navigate within the proxy
    shadowRoot.querySelectorAll('a').forEach(anchor => {
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        const newUrl = anchor.href;
        // Emit custom event for navigation
        shadowContainer.dispatchEvent(new CustomEvent('proxy-navigate', {
          detail: { url: newUrl },
          bubbles: true
        }));
      });
    });

    return shadowContainer;
  }

  /**
   * Modify CSS to fix z-index issues
   * @param {string} cssText - CSS text to modify
   * @returns {string} Modified CSS
   */
  modifyCss(cssText) {
    const zIndexRegex = /z-index\s*:\s*2147483647\s*;/g;
    return cssText.replace(zIndexRegex, 'z-index: 2147483643;');
  }

  /**
   * Generate a data URL for the current session
   * @returns {string} Data URL
   */
  generateDataURL() {
    const htmlContent = document.documentElement.outerHTML;
    return 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
  }

  /**
   * Generate a unique user ID
   * @returns {string} User ID
   */
  generateUserID() {
    const lowercase = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '01234567890123456789';
    let userId = 'Session ID: ';

    for (let i = 0; i < 14; i++) {
      if (i % 3 === 0) {
        userId += lowercase.charAt(Math.floor(Math.random() * lowercase.length));
      } else if (i % 3 === 1) {
        userId += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
      } else {
        userId += numbers.charAt(Math.floor(Math.random() * numbers.length));
      }
    }

    return userId;
  }

  /**
   * Toggle fullscreen mode
   */
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  }

  /**
   * Open current page in about:blank (tab cloaking)
   */
  openInAboutBlank() {
    const newWindow = window.open('about:blank', '_blank');
    const clonedDocument = document.documentElement.cloneNode(true);
    newWindow.document.write(clonedDocument.outerHTML);
    newWindow.document.close();
  }

  /**
   * Open current page in blob: URL (tab cloaking)
   */
  async openInBlob() {
    const htmlDocument = document.documentElement.cloneNode(true);
    const scripts = htmlDocument.querySelectorAll('script[src], script:not([src])');
    
    scripts.forEach(script => {
      const deferredScript = document.createElement('script');
      deferredScript.type = 'text/javascript';
      if (script.textContent) {
        deferredScript.textContent = `
          document.addEventListener('DOMContentLoaded', function() {
            ${script.textContent}
          });
        `;
      }
      if (script.src) {
        deferredScript.textContent = `
          document.addEventListener('DOMContentLoaded', function() {
            const script = document.createElement('script');
            script.src = "${script.src}";
            document.body.appendChild(script);
          });
        `;
      }
      script.parentNode.replaceChild(deferredScript, script);
    });

    const stylesheets = Array.from(document.styleSheets).filter(sheet => sheet.href);
    const cssPromises = stylesheets.map(async sheet => {
      try {
        const response = await fetch(sheet.href);
        const text = await response.text();
        const style = document.createElement('style');
        style.textContent = text;
        htmlDocument.querySelector('head').appendChild(style);
      } catch (e) {
        console.warn('Could not inline CSS:', sheet.href, e);
      }
    });

    await Promise.all(cssPromises);

    const blob = new Blob([htmlDocument.outerHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  /**
   * Clear all data (localStorage, sessionStorage, cookies)
   */
  clearAllData() {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie.split(';').forEach((cookie) => {
      const cookieName = cookie.split('=')[0].trim();
      document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;`;
    });
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ProxyEngine;
}
