// bare-mux SharedWorker transport for Ultraviolet
// INSTRUMENTED — original behavior preserved. No fixes.

const _BW = (msg, ...rest) => console.log('[BOOT-WORKER]', msg, 'at', Date.now(), ...rest);

self.onconnect = (event) => {
  const conPort = event.ports[0];
  _BW('port connected at', Date.now(), 'conPort type:', typeof conPort, 'isMessagePort:', conPort instanceof MessagePort);
  _BW('all event.ports length:', event.ports.length);

  conPort.onmessage = async (e) => {
    const msg = e.data;
    if (!msg.message) { _BW('received message WITHOUT .message property:', JSON.stringify(Object.keys(msg || {}))); return; }
    _BW('received message type:', msg.message.type || '(unknown)', 'at', Date.now());

    // Ping/pong keepalive
    if (msg.message.type === 'ping') {
      _BW('ping received, sending pong at', Date.now());
      try {
        msg.port.postMessage({ type: 'pong' });
        _BW('pong sent OK at', Date.now());
      } catch (e) {
        _BW('pong SEND FAILED at', Date.now(), 'error:', e.message, 'stack:', e.stack);
      }
      return;
    }

    // Forward fetch requests through the bare server at /bare/v1/
    if (msg.message.type === 'fetch') {
      const { remote, method, headers, body } = msg.message.fetch;

      // === INSTRUMENTATION: body details ===
      const bodyConstructor = body === undefined ? 'undefined' : (body === null ? 'null' : body.constructor.name);
      const bodyType = typeof body;
      const bodyIsRS = body instanceof ReadableStream;
      const bodyIsAB = body instanceof ArrayBuffer;
      const bodyIsBlob = body instanceof Blob;
      // byte length without consuming
      let bodyByteLen = 'N/A';
      if (body instanceof ArrayBuffer) bodyByteLen = body.byteLength;
      else if (body instanceof Blob) bodyByteLen = body.size;
      else if (typeof body === 'string') bodyByteLen = body.length;
      else if (body instanceof ReadableStream) bodyByteLen = 'ReadableStream(unreadable)';
      _BW('[INSTR] BODY constructor:', bodyConstructor, 'typeof:', bodyType, 'isRS:', bodyIsRS, 'isAB:', bodyIsAB, 'isBlob:', bodyIsBlob, 'byteLen:', bodyByteLen, 'remote:', remote, 'method:', method);
      // ===================================

      try {
        const targetUrl = new URL(remote);
        const bareUrl = self.origin + '/bare/v1/';
        const outgoingHeaders = headers || {};
        if (!outgoingHeaders.Host && !outgoingHeaders.host) {
          outgoingHeaders.Host = targetUrl.hostname;
        }
        const bareHeaders = {
          'X-Bare-Host': targetUrl.hostname,
          'X-Bare-Port': targetUrl.port || (targetUrl.protocol === 'https:' ? '443' : '80'),
          'X-Bare-Protocol': targetUrl.protocol,
          'X-Bare-Path': targetUrl.pathname + targetUrl.search,
          'X-Bare-Headers': JSON.stringify(outgoingHeaders),
          'X-Bare-Forward-Headers': JSON.stringify([])
        };

        // === ORIGINAL BEHAVIOR: body assigned directly, NO duplex, NO ArrayBuffer conversion ===
        const fetchOpts = { method: method || 'GET', headers: bareHeaders };
        if (body) {
          let reqBody = body;
          if (reqBody instanceof ReadableStream) {
            reqBody = await new Response(reqBody).blob();
          }
          fetchOpts.body = reqBody;
        }
        // ====================================================================================

        _BW('[INSTR] Pre-fetch bareUrl:', bareUrl, 'method:', fetchOpts.method, 'hasBody:', !!fetchOpts.body, 'bodyConstructor:', bodyConstructor, 'duplex:', fetchOpts.duplex || 'NOT SET');

        // === INSTRUMENTED fetch call: capture raw error object ===
        let bareResp;
        try {
          bareResp = await fetch(bareUrl, fetchOpts);
          _BW('[INSTR] Fetch succeeded status:', bareResp.status, 'ok:', bareResp.ok);
          _BW('[INSTR] Fetch response headers:', JSON.stringify([...bareResp.headers]));
        } catch (fetchErr) {
          // Capture the EXACT error object before any transformation
          const errConstructor = fetchErr === undefined ? 'undefined' : (fetchErr === null ? 'null' : fetchErr.constructor.name);
          const errIsTypeError = fetchErr instanceof TypeError;
          const errMsg = fetchErr === undefined ? 'undefined' : (fetchErr === null ? 'null' : (typeof fetchErr.message === 'string' ? fetchErr.message : String(fetchErr)));
          const errStack = fetchErr && fetchErr.stack ? fetchErr.stack : 'NO STACK AVAILABLE';
          const errType = typeof fetchErr;
          const errStr = String(fetchErr);
          _BW('[INSTR] ***** FETCH THREW *****');
          _BW('[INSTR] constructor:', errConstructor, 'isTypeError:', errIsTypeError, 'typeof:', errType);
          _BW('[INSTR] message:', errMsg);
          _BW('[INSTR] stack:', errStack);
          _BW('[INSTR] String(fetchErr):', errStr);
          throw fetchErr;  // re-throw to original outer catch
        }

        // === ORIGINAL behavior: single check, no retries ===
        const bareStatusHeader = bareResp.headers.get('X-Bare-Status');
        _BW('[INSTR] X-Bare-Status present:', bareStatusHeader !== null, 'value:', bareStatusHeader);

        if (bareStatusHeader === null) {
          // Log 502 creation BEFORE sending the response
          _BW('[INSTR] ***** GENERATING 502 *****: X-Bare-Status absent. bareResp status:', bareResp.status, 'bareResp statusText:', bareResp.statusText, 'bareResp headers:', JSON.stringify([...bareResp.headers]));
          // 429 check
          if (bareResp.status === 429) {
            _BW('[INSTR] bare server returned HTTP 429 Too Many Connections — rate limited');
          }
          msg.port.postMessage({ fetch: { body: null, headers: {}, status: 502, statusText: 'Bad Gateway' } });
          _BW('[INSTR] 502 response posted to caller');
          return;
        }

        const bareStatus = parseInt(bareStatusHeader || '0');
        const bareStatusText = bareResp.headers.get('X-Bare-Status-Text') || '';
        let bareResHeaders = {};
        try {
          const h = bareResp.headers.get('X-Bare-Headers');
          if (h) bareResHeaders = JSON.parse(h);
        } catch (_pe) {
          _BW('[INSTR] parse X-Bare-Headers error');
        }
        _BW('[INSTR] remote response status:', bareStatus, 'text:', bareStatusText);
        const noBody = [101, 204, 205, 304].includes(bareStatus);
        const responseBody = noBody ? undefined : await bareResp.arrayBuffer();
        _BW('[INSTR] response body length:', responseBody ? responseBody.byteLength : 0, 'noBody:', noBody);
        msg.port.postMessage(
          { fetch: { body: responseBody, headers: bareResHeaders, status: bareStatus, statusText: bareStatusText } },
          responseBody ? [responseBody] : []
        );
        _BW('[INSTR] response posted to caller, status:', bareStatus);
      } catch (err) {
        // === ORIGINAL CATCH BLOCK BEHAVIOR preserved exactly ===
        // Original code: msg.port.postMessage({ type: 'error', error: err.message });
        // But if err is a string (not Error), err.message is undefined, so we send 'undefined'
        const errMsg = err === undefined ? 'undefined' : (err === null ? 'null' : (typeof err.message === 'string' ? err.message : String(err)));
        _BW('[INSTR] ***** OUTER CATCH *****');
        _BW('[INSTR] err === undefined:', err === undefined, 'err === null:', err === null);
        _BW('[INSTR] typeof err:', typeof err, 'constructor:', err && err.constructor && err.constructor.name);
        _BW('[INSTR] err.message:', err && err.message);
        _BW('[INSTR] err.stack:', err && err.stack);
        _BW('[INSTR] String(err):', String(err));
        _BW('[INSTR] errMsg to be sent:', errMsg);
        _BW('[INSTR] postMessaging error:', errMsg);
        msg.port.postMessage({ type: 'error', error: errMsg });
        _BW('[INSTR] error message posted');
      }
      return;
    }

    // WebSocket forwarding (unchanged)
    if (msg.message.type === 'websocket') {
      const wsData = msg.message.websocket;
      _BW('websocket connecting to:', wsData.url);
      try {
        const ws = new WebSocket(wsData.url, wsData.protocols);
        ws.onopen = () => {
          _BW('websocket opened');
          wsData.channel.postMessage({ type: 'open', args: [wsData.protocols] });
        };
        ws.onmessage = (evt) => {
          const data = evt.data;
          if (data instanceof ArrayBuffer || data instanceof Blob) {
            wsData.channel.postMessage({ type: 'message', args: [data] }, [data]);
          } else {
            wsData.channel.postMessage({ type: 'message', args: [data] });
          }
        };
        ws.onclose = (evt) => {
          _BW('websocket closed:', evt.code, evt.reason);
          wsData.channel.postMessage({ type: 'close', args: [evt.code, evt.reason] });
        };
        ws.onerror = () => {
          _BW('websocket error');
          wsData.channel.postMessage({ type: 'error', args: [] });
        };
        msg.port.postMessage({ type: 'websocket' });
      } catch (err) {
        _BW('websocket ERROR:', err.message);
        msg.port.postMessage({ type: 'error', error: err.message });
      }
      return;
    }
  };
};
