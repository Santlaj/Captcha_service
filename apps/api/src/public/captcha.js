(function (window, document) {
  'use strict';

  var DEFAULT_API_URL = (function () {
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || '';
      if (src.indexOf('captcha.js') !== -1) {
        var a = document.createElement('a');
        a.href = src;
        return a.protocol + '//' + a.host;
      }
    }
    return window.location.origin;
  })();

  // Inject scoped styles once
  var STYLE_ID = 'captcha-service-embedded-styles';
  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.cs-widget-wrap { display: inline-flex; flex-direction: column; gap: 6px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
      '.cs-row { display: flex; align-items: center; gap: 8px; }',
      '.cs-img-box { width: 110px; height: 44px; flex-shrink: 0; border-radius: 8px; border: 1px solid #e2e8f0; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }',
      '.cs-img-box.dark { background: #0f172a; border-color: #334155; }',
      '.cs-img { width: 100%; height: 100%; display: block; user-select: none; -webkit-user-drag: none; }',
      '.cs-input-box { position: relative; }',
      '.cs-input { width: 160px; height: 44px; box-sizing: border-box; padding: 0 12px; border-radius: 8px; border: 1px solid #cbd5e1; font-size: 14px; color: #0f172a; background: #ffffff; outline: none; transition: border-color 0.15s, box-shadow 0.15s; }',
      '.cs-input:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }',
      '.cs-input.dark { background: #0f172a; border-color: #334155; color: #f8fafc; }',
      '.cs-input.dark:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.25); }',
      '.cs-input.verified { border-color: #10b981; background: #ecfdf5; color: #065f46; font-weight: 600; }',
      '.cs-input.verified.dark { border-color: #10b981; background: rgba(16,185,129,0.1); color: #34d399; }',
      '.cs-reload-btn { width: 32px; height: 32px; flex-shrink: 0; border: none; background: transparent; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #64748b; transition: background-color 0.15s, color 0.15s; }',
      '.cs-reload-btn:hover { background-color: #f1f5f9; color: #0f172a; }',
      '.cs-reload-btn.dark:hover { background-color: #1e293b; color: #f8fafc; }',
      '.cs-reload-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
      '.cs-reload-icon { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }',
      '.cs-spin { animation: cs-spinner 0.8s linear infinite; }',
      '@keyframes cs-spinner { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
      '.cs-msg { font-size: 11px; margin: 0; padding-left: 2px; }',
      '.cs-msg-err { color: #ef4444; }',
      '.cs-msg-ok { color: #10b981; font-weight: 500; }'
    ].join('\n');
    document.head.appendChild(style);
  }

  function createWidget(container, opts) {
    var siteKey = opts.siteKey || container.getAttribute('data-sitekey') || '';
    var apiUrl = (opts.apiUrl || container.getAttribute('data-api-url') || DEFAULT_API_URL).replace(/\/+$/, '');
    var isDark = (opts.theme || container.getAttribute('data-theme') || 'light') === 'dark';
    var onVerify = typeof opts.onVerify === 'function' ? opts.onVerify : null;

    var challengeId = null;
    var currentToken = null;
    var isBusy = false;

    // Build DOM structure
    container.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'cs-widget-wrap';

    var row = document.createElement('div');
    row.className = 'cs-row';

    // 1. Image container
    var imgBox = document.createElement('div');
    imgBox.className = 'cs-img-box' + (isDark ? ' dark' : '');
    imgBox.innerHTML = '<span style="font-size:11px;color:#94a3b8;">Loading...</span>';

    // 2. Input box
    var inputWrap = document.createElement('div');
    inputWrap.className = 'cs-input-box';
    var input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 6;
    input.className = 'cs-input' + (isDark ? ' dark' : '');
    input.placeholder = 'enter captcha';
    input.autocomplete = 'off';
    input.spellcheck = false;
    inputWrap.appendChild(input);

    // Hidden form input for automatic token submission with parent <form>
    var hiddenTokenInput = document.createElement('input');
    hiddenTokenInput.type = 'hidden';
    hiddenTokenInput.name = 'captcha_token';
    hiddenTokenInput.value = '';
    inputWrap.appendChild(hiddenTokenInput);

    // 3. Reload button
    var reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.className = 'cs-reload-btn' + (isDark ? ' dark' : '');
    reloadBtn.title = 'Refresh CAPTCHA';
    reloadBtn.innerHTML = '<svg class="cs-reload-icon" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';

    row.appendChild(imgBox);
    row.appendChild(inputWrap);
    row.appendChild(reloadBtn);

    var msgEl = document.createElement('p');
    msgEl.className = 'cs-msg';
    msgEl.style.display = 'none';

    wrap.appendChild(row);
    wrap.appendChild(msgEl);
    container.appendChild(wrap);

    function showMessage(text, isError) {
      if (!text) {
        msgEl.style.display = 'none';
        return;
      }
      msgEl.textContent = text;
      msgEl.className = 'cs-msg ' + (isError ? 'cs-msg-err' : 'cs-msg-ok');
      msgEl.style.display = 'block';
    }

    function loadChallenge() {
      if (isBusy) return;
      isBusy = true;
      currentToken = null;
      hiddenTokenInput.value = '';
      input.value = '';
      input.disabled = false;
      input.className = 'cs-input' + (isDark ? ' dark' : '');
      input.placeholder = 'enter captcha';
      reloadBtn.disabled = true;
      reloadBtn.querySelector('svg').classList.add('cs-spin');
      imgBox.innerHTML = '<span style="font-size:11px;color:#94a3b8;">Loading...</span>';
      showMessage(null);

      fetch(apiUrl + '/api/v1/challenge', {
        headers: { 'X-Site-Key': siteKey }
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          challengeId = data.challengeId;
          imgBox.innerHTML = '<img class="cs-img" src="' + data.image + '" alt="CAPTCHA Challenge" />';
        })
        .catch(function () {
          imgBox.innerHTML = '<span style="font-size:11px;color:#ef4444;">Failed</span>';
          showMessage('Failed to load challenge. Click 🔄 to retry.', true);
        })
        .finally(function () {
          isBusy = false;
          reloadBtn.disabled = false;
          reloadBtn.querySelector('svg').classList.remove('cs-spin');
        });
    }

    function submitSolution(val) {
      if (!challengeId || isBusy) return;
      isBusy = true;
      input.disabled = true;
      showMessage('Verifying...', false);

      fetch(apiUrl + '/api/v1/solution', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Site-Key': siteKey
        },
        body: JSON.stringify({ challengeId: challengeId, answer: val })
      })
        .then(function (res) {
          return res.json().then(function (body) {
            return { ok: res.ok, data: body };
          });
        })
        .then(function (res) {
          if (res.ok && res.data.success) {
            currentToken = res.data.verificationToken;
            hiddenTokenInput.value = currentToken;
            input.value = '';
            input.placeholder = 'verified ✓';
            input.className = 'cs-input verified' + (isDark ? ' dark' : '');
            input.disabled = true;
            showMessage('Verification successful', false);

            if (onVerify) onVerify(currentToken);
            container.dispatchEvent(new CustomEvent('captcha-verified', {
              detail: { token: currentToken }
            }));
          } else {
            var errMsg = (res.data && res.data.error) || 'Incorrect digits. Try again.';
            showMessage(errMsg, true);
            input.disabled = false;
            input.value = '';
            input.focus();
            if (res.data && res.data.code === 'ATTEMPTS_EXCEEDED') {
              loadChallenge();
            }
          }
        })
        .catch(function () {
          showMessage('Verification failed. Please retry.', true);
          input.disabled = false;
        })
        .finally(function () {
          isBusy = false;
        });
    }

    input.addEventListener('input', function () {
      var clean = input.value.replace(/\D/g, '').slice(0, 6);
      input.value = clean;
      if (clean.length === 6) {
        submitSolution(clean);
      }
    });

    reloadBtn.addEventListener('click', function () {
      loadChallenge();
    });

    loadChallenge();

    return {
      reset: loadChallenge,
      getResponse: function () { return currentToken; }
    };
  }

  // Global API exposed for script consumers
  window.CaptchaService = {
    render: createWidget,
    reset: function (container) {
      if (container && container._csInstance) {
        container._csInstance.reset();
      }
    },
    getResponse: function (container) {
      if (container && container._csInstance) {
        return container._csInstance.getResponse();
      }
      var hidden = container ? container.querySelector('input[name="captcha_token"]') : null;
      return hidden ? hidden.value : '';
    }
  };

  // Auto-initialize any .captcha-service or .captcha-widget on DOM ready
  function autoInit() {
    var elements = document.querySelectorAll('.captcha-service, .captcha-widget');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el._csInstance) {
        el._csInstance = createWidget(el, {});
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})(window, document);
