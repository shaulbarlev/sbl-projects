/**
 * The admin client, inlined into the shell as one <script>.
 *
 * Kept as a string rather than a bundled entry point on purpose: it is ~200
 * lines, it ships on the critical path of a phone in a hurry, and a build step
 * for it would be more configuration than code.
 */
export const ADMIN_JS = String.raw`
(function () {
  var state = null;
  var tick = null;

  function api(path, body, method) {
    return fetch('/_/api/' + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: Object.assign({ 'x-skin-request': '1' }, body ? { 'content-type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) { location.href = '/_/login'; throw new Error('unauthorised'); }
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data && data.error ? data.error : 'Request failed');
        return data;
      });
    });
  }

  function toast(message, isError) {
    var el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'show' + (isError ? ' err' : '');
    setTimeout(function () { el.className = ''; }, 2600);
  }

  function act(promise, okMessage) {
    return promise.then(function (data) {
      state = data;
      render();
      if (okMessage) toast(okMessage);
    }).catch(function (err) { toast(err.message, true); });
  }

  function describe(target) {
    if (!target) return '—';
    return target.kind === 'url' ? target.url : target.name;
  }

  function remaining(ms) {
    if (ms <= 0) return '0:00';
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var mm = h > 0 && m < 10 ? '0' + m : String(m);
    var ss = s < 10 ? '0' + s : String(s);
    return (h > 0 ? h + ':' : '') + mm + ':' + ss;
  }

  function renderLive() {
    var res = state.resolution;
    document.getElementById('live-src').textContent =
      res.source === 'temp' ? 'temporary' : res.source === 'main' ? 'main' : 'fallback';
    document.getElementById('live-url').textContent = describe(res.target);

    var meta = document.getElementById('live-meta');
    var controls = document.getElementById('temp-controls');
    if (tick) { clearInterval(tick); tick = null; }

    if (res.source === 'temp') {
      controls.hidden = false;
      var paint = function () {
        var left = res.expiresAt - Date.now();
        if (left <= 0) { refresh(); return; }
        meta.innerHTML = 'reverts to <b>' + escapeHtml(describe(state.main && state.main.target)) +
          '</b> in <span id="countdown">' + remaining(left) + '</span>';
      };
      paint();
      tick = setInterval(paint, 1000);
    } else {
      controls.hidden = true;
      meta.textContent = res.source === 'fallback'
        ? 'No main target set — serving the configured fallback.'
        : 'No temporary redirect active.';
    }
    document.getElementById('hits').textContent = state.hits + (state.hits === 1 ? ' scan' : ' scans');
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function renderList(id, entries, onPick, onDelete, emptyText) {
    var host = document.getElementById(id);
    host.innerHTML = '';
    if (!entries.length) {
      host.innerHTML = '<p class="hint">' + emptyText + '</p>';
      return;
    }
    entries.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'item';

      var name = document.createElement('div');
      name.className = 'name';
      name.innerHTML = escapeHtml(entry.title) +
        (entry.subtitle ? '<span class="sub">' + escapeHtml(entry.subtitle) + '</span>' : '');
      row.appendChild(name);

      var temp = document.createElement('button');
      temp.textContent = 'temp';
      temp.onclick = function () { onPick(entry, 'temp'); };
      row.appendChild(temp);

      var main = document.createElement('button');
      main.textContent = 'main';
      main.onclick = function () { onPick(entry, 'main'); };
      row.appendChild(main);

      if (onDelete) {
        var del = document.createElement('button');
        del.className = 'ghost';
        del.textContent = '✕';
        del.setAttribute('aria-label', 'Delete ' + entry.title);
        del.onclick = function () { onDelete(entry); };
        row.appendChild(del);
      }
      host.appendChild(row);
    });
  }

  function applyTarget(target, slot) {
    if (slot === 'main') {
      // Main is the slot that is still wrong three weeks later. Temp expires on
      // its own, so only this one earns a confirmation step.
      if (!confirm('Set MAIN redirect to:\n\n' + describe(target) + '\n\nThis persists until you change it.')) return;
      act(api('main', { target: target }), 'Main set');
    } else {
      var minutes = Number(document.getElementById('duration').value);
      act(api('temp', { target: target, durationMs: minutes * 60000 }), 'Temp set for ' + minutes + 'm');
    }
  }

  function render() {
    renderLive();
    document.getElementById('splash-toggle').checked = state.splash;

    renderList('bookmarks',
      state.bookmarks.map(function (b) {
        return { title: b.label, subtitle: describe(b.target), target: b.target, id: b.id };
      }),
      function (entry, slot) { applyTarget(entry.target, slot); },
      function (entry) {
        if (confirm('Delete bookmark "' + entry.title + '"?')) {
          act(api('bookmarks/' + encodeURIComponent(entry.id), null, 'DELETE'), 'Bookmark deleted');
        }
      },
      'No bookmarks yet.');

    renderList('mru',
      state.mru.map(function (e) { return { title: describe(e.target), target: e.target }; }),
      function (entry, slot) { applyTarget(entry.target, slot); },
      null,
      'Nothing set yet.');

    renderList('files',
      state.files.map(function (f) {
        return {
          title: f.name,
          subtitle: formatSize(f.size) + ' · ' + (f.type || 'unknown'),
          target: { kind: 'file', key: f.key, name: f.name },
          key: f.key
        };
      }),
      function (entry, slot) { applyTarget(entry.target, slot); },
      function (entry) {
        if (confirm('Delete file "' + entry.title + '" permanently?')) {
          act(api('files/' + encodeURIComponent(entry.key), null, 'DELETE'), 'File deleted');
        }
      },
      'No uploads yet.');
  }

  function refresh() { return api('state').then(function (data) { state = data; render(); }); }

  document.getElementById('custom-form').onsubmit = function (event) {
    event.preventDefault();
    var input = document.getElementById('custom-url');
    var value = input.value.trim();
    if (!value) return;
    var slot = event.submitter && event.submitter.value === 'main' ? 'main' : 'temp';
    applyTarget({ kind: 'url', url: value }, slot);
    input.value = '';
  };

  document.getElementById('bookmark-form').onsubmit = function (event) {
    event.preventDefault();
    var label = document.getElementById('bm-label');
    var url = document.getElementById('bm-url');
    if (!label.value.trim() || !url.value.trim()) return;
    act(api('bookmarks', { label: label.value.trim(), target: { kind: 'url', url: url.value.trim() } }),
      'Bookmark added').then(function () { label.value = ''; url.value = ''; });
  };

  document.getElementById('upload-input').onchange = function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var status = document.getElementById('upload-status');
    status.textContent = 'Uploading ' + file.name + '…';
    fetch('/_/api/upload?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: { 'x-skin-request': '1', 'content-type': file.type || 'application/octet-stream' },
      body: file
    }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; }); })
      .then(function (data) {
        state = data.state;
        render();
        status.textContent = '';
        toast('Uploaded — pick temp or main below');
      })
      .catch(function (err) { status.textContent = ''; toast(err.message, true); });
    event.target.value = '';
  };

  document.getElementById('splash-toggle').onchange = function (event) {
    act(api('splash', { on: event.target.checked }), event.target.checked ? 'Splash on' : 'Splash off');
  };

  document.getElementById('end-now').onclick = function () {
    act(api('temp', null, 'DELETE'), 'Temp ended');
  };
  document.getElementById('extend').onclick = function () {
    act(api('temp/extend', { byMs: 15 * 60000 }), 'Extended 15m');
  };

  document.querySelectorAll('[data-duration]').forEach(function (button) {
    button.onclick = function () {
      document.getElementById('duration').value = button.dataset.duration;
      document.querySelectorAll('[data-duration]').forEach(function (other) {
        other.className = other === button ? 'primary' : '';
      });
    };
  });

  // A panel showing a phantom temp that already expired is worse than no panel.
  setInterval(refresh, 20000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  refresh().then(function () {
    if (new URLSearchParams(location.search).get('reset') === '1') {
      act(api('temp', null, 'DELETE'), 'Reset to main');
      history.replaceState({}, '', '/_/');
    }
  });
})();
`;
