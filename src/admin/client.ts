/**
 * The admin client, inlined into the shell as one <script>.
 *
 * Kept as a string rather than a bundled entry point on purpose: it ships on
 * the critical path of a phone in a hurry, and a build step for it would be
 * more configuration than code.
 */
export const ADMIN_JS = String.raw`
(function () {
  var state = null;
  var tick = null;
  var duration = 60;
  var seqDuration = 60;
  var customMode = 'link';
  var stepMode = 'message';
  var TABS = ['now', 'library', 'sequence', 'settings'];

  /* ------------------------------------------------------------- plumbing */

  function api(path, body, method) {
    return fetch('/_/api/' + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: Object.assign({ 'x-skin-request': '1' },
        body ? { 'content-type': 'application/json' } : {}),
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
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = ''; }, 2600);
  }

  function act(promise, okMessage) {
    return promise.then(function (data) {
      state = data;
      render();
      if (okMessage) toast(okMessage);
      return data;
    }).catch(function (err) { toast(err.message, true); });
  }

  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function findPool(id) {
    return (state.pools || []).filter(function (p) { return p.id === id; })[0] || null;
  }

  function describe(target) {
    if (!target) return '—';
    if (target.kind === 'url') return target.url;
    if (target.kind === 'file') return target.name;
    if (target.kind === 'pool') {
      var pool = findPool(target.poolId);
      return pool ? pool.name + ' (' + pool.items.length + ' images)' : 'Image set';
    }
    return '“' + target.text + '”';
  }

  function kindLabel(target) {
    if (!target) return '';
    if (target.kind === 'url') return 'link';
    if (target.kind === 'file') return 'file';
    if (target.kind === 'pool') return 'random image';
    return 'message';
  }

  function fileName(key) {
    var file = state.files.filter(function (f) { return f.key === key; })[0];
    return file ? file.name : key;
  }

  function remaining(ms) {
    if (ms <= 0) return '0:00';
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return (h > 0 ? h + ':' + (m < 10 ? '0' + m : m) : String(m)) + ':' + (s < 10 ? '0' + s : s);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  /* ------------------------------------------------------------ tab router */

  function showTab(name) {
    if (TABS.indexOf(name) < 0) name = 'now';
    TABS.forEach(function (id) {
      $('panel-' + id).hidden = id !== name;
      $('tab-' + id).setAttribute('aria-selected', String(id === name));
    });
    if (location.hash.slice(1) !== name) history.replaceState({}, '', '#' + name);
    window.scrollTo(0, 0);
  }

  TABS.forEach(function (id) {
    $('tab-' + id).onclick = function () { showTab(id); };
  });
  window.addEventListener('hashchange', function () { showTab(location.hash.slice(1)); });
  $('status').onclick = function () { showTab('now'); };
  $('status').onkeydown = function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showTab('now'); }
  };

  /* ------------------------------------------------------------- rendering */

  function pips(host, done, total) {
    host.innerHTML = '';
    for (var i = 0; i < total; i++) {
      var pip = document.createElement('span');
      pip.className = 'pip' + (i < done ? ' done' : '');
      host.appendChild(pip);
    }
  }

  function button(label, className, onClick) {
    var el = document.createElement('button');
    el.textContent = label;
    if (className) el.className = className;
    el.onclick = onClick;
    return el;
  }

  function renderLive() {
    var res = state.resolution;
    var seq = state.sequenceStatus;
    var card = $('live');
    var bar = $('status');
    var actions = $('live-actions');
    var livePips = $('live-pips');

    if (tick) { clearInterval(tick); tick = null; }
    actions.innerHTML = '';
    actions.hidden = false;

    var flavour = seq.live ? 'sequence' : res.source === 'temp' ? 'temp'
      : res.source === 'fallback' ? 'fallback' : 'main';
    card.className = 'card live is-' + flavour;
    bar.className = 'is-' + flavour;

    var kicker, headline, meta, deadline;

    if (seq.live) {
      // A live sequence has not resolved to one thing — it resolves per
      // scanner — so the headline is what the *next* person will get.
      var next = state.sequence.steps[seq.cursor];
      kicker = 'Sequence · ' + seq.cursor + ' of ' + seq.total + ' claimed';
      headline = 'Next: ' + describe(next && next.target);
      meta = seq.remaining + ' left, then back to <b>' + esc(describe(fallbackTarget())) + '</b>';
      deadline = seq.expiresAt;
      pips(livePips, seq.cursor, seq.total);
      livePips.hidden = false;
      actions.appendChild(button('Disarm', 'danger', disarmSequence));
      actions.appendChild(button('Open sequence', '', function () { showTab('sequence'); }));
    } else {
      livePips.hidden = true;
      headline = describe(res.target);
      if (res.source === 'temp') {
        kicker = 'Temporary';
        meta = 'reverts to <b>' + esc(describe(fallbackTarget())) + '</b> in <span id="countdown"></span>';
        deadline = res.expiresAt;
        actions.appendChild(button('End now', 'danger', function () {
          act(api('temp', null, 'DELETE'), 'Back to main');
        }));
        actions.appendChild(button('+15m', '', function () {
          act(api('temp/extend', { byMs: 900000 }), 'Extended 15 minutes');
        }));
      } else if (res.source === 'fallback') {
        kicker = 'Fallback';
        meta = 'No main destination set — scans go to the configured fallback.';
        actions.hidden = true;
      } else {
        kicker = 'Main';
        meta = 'No temporary redirect or sequence active.';
        actions.hidden = true;
      }
    }

    $('live-src').textContent = kicker;
    $('live-url').textContent = headline;
    $('status-kicker').textContent = kicker;
    $('status-now').textContent = headline;

    var metaEl = $('live-meta');
    var paint = function () {
      var left = deadline - Date.now();
      if (left <= 0) { refresh(); return; }
      metaEl.innerHTML = meta;
      var counter = $('countdown');
      if (counter) counter.textContent = remaining(left);
      $('status-timer').textContent = remaining(left);
    };

    if (deadline) {
      paint();
      tick = setInterval(paint, 1000);
    } else {
      metaEl.innerHTML = meta;
      $('status-timer').textContent = '';
    }

    var badge = $('seq-badge');
    badge.hidden = !seq.live;
    badge.textContent = seq.remaining;

    $('hits').textContent = state.hits + (state.hits === 1 ? ' scan' : ' scans');
  }

  /** What scans fall back to once the temp or sequence is done. */
  function fallbackTarget() {
    return state.main ? state.main.target : null;
  }

  function renderList(id, entries, options) {
    var host = $(id);
    host.innerHTML = '';
    if (!entries.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = options.empty;
      host.appendChild(empty);
      return;
    }
    entries.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'item';

      var name = document.createElement('div');
      name.className = 'name';
      name.innerHTML = esc(entry.title) +
        (entry.subtitle ? '<span class="sub">' + esc(entry.subtitle) + '</span>' : '');
      row.appendChild(name);

      row.appendChild(button('temp', '', function () { applyTarget(entry.target, 'temp'); }));
      row.appendChild(button('main', '', function () { applyTarget(entry.target, 'main'); }));

      if (options.onDelete) {
        row.appendChild(button('✕', 'ghost', function () { options.onDelete(entry); }));
      }
      host.appendChild(row);
    });
  }

  function renderSequence() {
    var seq = state.sequence;
    var status = state.sequenceStatus;
    var steps = seq ? seq.steps : [];

    $('seq-state').textContent = status.live
      ? 'Armed · ' + status.cursor + ' of ' + status.total + ' claimed'
      : steps.length ? 'Ready · ' + steps.length + ' step' + (steps.length === 1 ? '' : 's')
      : 'No steps yet';

    var seqPips = $('seq-pips');
    seqPips.hidden = !status.live;
    if (status.live) pips(seqPips, status.cursor, status.total);

    $('seq-meta').innerHTML = status.live
      ? status.remaining + ' scan' + (status.remaining === 1 ? '' : 's') + ' left before scans go back to normal.'
      : steps.length
        ? 'Arming hands step 1 to the next person who scans, step 2 to the one after, and so on.'
        : 'Add at least one step below.';

    var actions = $('seq-actions');
    actions.innerHTML = '';
    if (status.live) {
      actions.appendChild(button('Disarm', 'danger', disarmSequence));
      actions.appendChild(button('Restart', 'seq', armSequence));
    } else {
      var arm = button(steps.length ? 'Arm ' + steps.length + ' step' +
        (steps.length === 1 ? '' : 's') : 'Arm', 'seq', armSequence);
      arm.disabled = !steps.length;
      actions.appendChild(arm);
    }

    var host = $('steps');
    host.innerHTML = '';
    if (!steps.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No steps. Add one below.';
      host.appendChild(empty);
      return;
    }

    steps.forEach(function (step, index) {
      var row = document.createElement('div');
      var claimed = status.live && index < status.cursor;
      var isNext = status.live && index === status.cursor;
      row.className = 'item' + (claimed ? ' claimed' : '') + (isNext ? ' next' : '');

      var idx = document.createElement('span');
      idx.className = 'idx';
      idx.textContent = claimed ? '✓' : String(index + 1);
      row.appendChild(idx);

      var name = document.createElement('div');
      name.className = 'name';
      name.innerHTML = esc(describe(step.target)) +
        '<span class="sub">' + kindLabel(step.target) +
        (isNext ? ' · next up' : claimed ? ' · claimed' : '') + '</span>';
      row.appendChild(name);

      var up = button('↑', 'ghost', function () { moveStep(index, -1); });
      up.disabled = index === 0;
      row.appendChild(up);

      var down = button('↓', 'ghost', function () { moveStep(index, 1); });
      down.disabled = index === steps.length - 1;
      row.appendChild(down);

      row.appendChild(button('✕', 'ghost', function () { removeStep(index); }));
      host.appendChild(row);
    });
  }

  /**
   * Image sets. Rendered by hand rather than through renderList because a set
   * is worth showing as its contents — a wall of filenames tells you nothing
   * about which photos are in there.
   */
  function renderPools() {
    var host = $('pools');
    host.innerHTML = '';
    var pools = state.pools || [];

    if (!pools.length) {
      var empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'No sets yet. Create one, then add images to it.';
      host.appendChild(empty);
      return;
    }

    pools.forEach(function (pool) {
      var card = document.createElement('div');
      card.className = 'card pool';

      var head = document.createElement('div');
      head.className = 'item';
      head.style.border = '0';
      head.style.padding = '0';

      var name = document.createElement('div');
      name.className = 'name';
      name.innerHTML = esc(pool.name) +
        '<span class="sub">' + pool.items.length +
        (pool.items.length === 1 ? ' image' : ' images') + '</span>';
      head.appendChild(name);

      var target = { kind: 'pool', poolId: pool.id };
      var temp = button('temp', '', function () { applyTarget(target, 'temp'); });
      var main = button('main', '', function () { applyTarget(target, 'main'); });
      // A set with nothing in it cannot serve anything, so offering to point
      // the code at it would just be a way to break the QR.
      temp.disabled = main.disabled = pool.items.length === 0;
      head.appendChild(temp);
      head.appendChild(main);
      head.appendChild(button('✕', 'ghost', function () {
        if (confirm('Delete set "' + pool.name + '"? The images stay in Files.')) {
          act(api('pools/' + encodeURIComponent(pool.id), null, 'DELETE'), 'Set deleted');
        }
      }));
      card.appendChild(head);

      if (pool.items.length) {
        var strip = document.createElement('div');
        strip.className = 'strip';
        pool.items.forEach(function (key) {
          var cell = document.createElement('div');
          cell.className = 'thumb';
          var img = document.createElement('img');
          img.src = '/f/' + key + '/' + encodeURIComponent(fileName(key));
          img.alt = fileName(key);
          img.loading = 'lazy';
          cell.appendChild(img);
          cell.appendChild(button('✕', 'ghost', function () {
            act(api('pools/' + encodeURIComponent(pool.id) + '/items/' + encodeURIComponent(key),
              null, 'DELETE'), 'Removed from set');
          }));
          strip.appendChild(cell);
        });
        card.appendChild(strip);
      }

      var add = button('Add images', '', function () {
        uploadingToPool = pool.id;
        $('pool-upload').click();
      });
      add.style.width = '100%';
      add.style.marginTop = '10px';
      card.appendChild(add);
      host.appendChild(card);
    });
  }

  function render() {
    renderLive();
    renderSequence();
    renderPools();
    $('splash-toggle').checked = state.splash;

    renderList('bookmarks', state.bookmarks.map(function (b) {
      // An unlabelled bookmark shows the destination as its name rather than a
      // blank row; labelling it only adds the destination underneath.
      return {
        title: b.label || describe(b.target),
        subtitle: b.label ? describe(b.target) : '',
        target: b.target,
        id: b.id
      };
    }), {
      empty: 'No bookmarks yet.',
      onDelete: function (entry) {
        if (confirm('Delete bookmark "' + entry.title + '"?')) {
          act(api('bookmarks/' + encodeURIComponent(entry.id), null, 'DELETE'), 'Bookmark deleted');
        }
      }
    });

    renderList('mru', state.mru.map(function (e) {
      return { title: describe(e.target), subtitle: kindLabel(e.target), target: e.target };
    }), { empty: 'Nothing set yet.' });

    renderList('files', state.files.map(function (f) {
      return {
        title: f.name,
        subtitle: formatSize(f.size) + ' · ' + (f.type || 'unknown'),
        target: { kind: 'file', key: f.key, name: f.name },
        key: f.key
      };
    }), {
      empty: 'No uploads yet.',
      onDelete: function (entry) {
        if (confirm('Delete file "' + entry.title + '" permanently?')) {
          act(api('files/' + encodeURIComponent(entry.key), null, 'DELETE'), 'File deleted');
        }
      }
    });
  }

  /* --------------------------------------------------------------- actions */

  function applyTarget(target, slot) {
    if (slot === 'main') {
      // Main is the slot that is still wrong three weeks later. Temp expires on
      // its own, so only this one earns a confirmation step.
      if (!confirm('Set MAIN destination to:\n\n' + describe(target) +
        '\n\nThis persists until you change it.')) return;
      act(api('main', { target: target }), 'Main set');
    } else {
      act(api('temp', { target: target, durationMs: duration * 60000 }),
        'Temporary for ' + duration + 'm');
    }
  }

  function currentCustomTarget() {
    if (customMode === 'message') {
      var text = $('custom-text').value.trim();
      return text ? { kind: 'text', text: text } : null;
    }
    var url = $('custom-url').value.trim();
    return url ? { kind: 'url', url: url } : null;
  }

  function sendCustom(slot) {
    var target = currentCustomTarget();
    if (!target) { toast('Nothing to send', true); return; }
    applyTarget(target, slot);
    $('custom-url').value = '';
    $('custom-text').value = '';
  }

  function saveSteps(steps, okMessage) {
    return act(api('sequence/steps', {
      steps: steps.map(function (s) { return { target: s.target }; })
    }), okMessage);
  }

  function moveStep(index, delta) {
    var steps = state.sequence.steps.slice();
    var to = index + delta;
    if (to < 0 || to >= steps.length) return;
    var moved = steps.splice(index, 1)[0];
    steps.splice(to, 0, moved);
    saveSteps(steps);
  }

  function removeStep(index) {
    var steps = state.sequence.steps.slice();
    steps.splice(index, 1);
    saveSteps(steps, 'Step removed');
  }

  function armSequence() {
    act(api('sequence/arm', { durationMs: seqDuration * 60000 }),
      'Armed for ' + seqDuration + 'm');
  }

  function disarmSequence() {
    act(api('sequence/arm', null, 'DELETE'), 'Sequence disarmed');
  }

  /* --------------------------------------------------------------- wiring */

  function pickGroup(selector, onPick) {
    document.querySelectorAll(selector).forEach(function (btn) {
      btn.onclick = function () {
        document.querySelectorAll(selector).forEach(function (other) {
          other.className = other.className.replace(/\s*primary/, '');
        });
        btn.className += ' primary';
        onPick(btn);
      };
    });
  }

  pickGroup('[data-duration]', function (btn) {
    duration = Number(btn.dataset.duration);
    $('duration').value = btn.dataset.duration;
  });
  pickGroup('[data-seqduration]', function (btn) {
    seqDuration = Number(btn.dataset.seqduration);
  });
  pickGroup('[data-mode]', function (btn) {
    customMode = btn.dataset.mode;
    $('custom-url').hidden = customMode !== 'link';
    $('custom-text').hidden = customMode !== 'message';
  });
  pickGroup('[data-stepmode]', function (btn) {
    stepMode = btn.dataset.stepmode;
    $('step-text').hidden = stepMode !== 'message';
    $('step-url').hidden = stepMode !== 'link';
  });

  $('duration').oninput = function () {
    var value = Number($('duration').value);
    if (value > 0) duration = value;
  };

  $('send-temp').onclick = function () { sendCustom('temp'); };
  $('send-main').onclick = function () { sendCustom('main'); };

  $('bm-add').onclick = function () {
    var label = $('bm-label');
    var url = $('bm-url');
    if (!url.value.trim()) { toast('URL required', true); return; }
    act(api('bookmarks', { label: label.value.trim(), target: { kind: 'url', url: url.value.trim() } }),
      'Bookmark added').then(function () { label.value = ''; url.value = ''; });
  };

  $('step-add').onclick = function () {
    var target;
    if (stepMode === 'message') {
      var text = $('step-text').value.trim();
      if (!text) { toast('Message is empty', true); return; }
      target = { kind: 'text', text: text };
    } else {
      var url = $('step-url').value.trim();
      if (!url) { toast('Link is empty', true); return; }
      target = { kind: 'url', url: url };
    }
    var steps = (state.sequence ? state.sequence.steps : []).concat([{ target: target }]);
    saveSteps(steps, 'Step added').then(function () {
      $('step-text').value = '';
      $('step-url').value = '';
    });
  };

  var uploadingToPool = null;

  function uploadOne(file, poolId) {
    var query = '?name=' + encodeURIComponent(file.name) +
      (poolId ? '&pool=' + encodeURIComponent(poolId) : '');
    return fetch('/_/api/upload' + query, {
      method: 'POST',
      headers: { 'x-skin-request': '1', 'content-type': file.type || 'application/octet-stream' },
      body: file
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Upload failed');
        return d;
      });
    });
  }

  $('pool-add').onclick = function () {
    var name = $('pool-name');
    if (!name.value.trim()) { toast('Name the set first', true); return; }
    act(api('pools', { name: name.value.trim() }), 'Set created')
      .then(function () { name.value = ''; });
  };

  $('pool-upload').onchange = function (event) {
    var files = Array.prototype.slice.call(event.target.files || []);
    var poolId = uploadingToPool;
    event.target.value = '';
    if (!files.length || !poolId) return;

    // Sequential, not parallel: a dozen phone photos uploaded at once from a
    // phone connection is a good way to have several of them fail.
    var done = 0;
    var status = $('upload-status');
    var next = function () {
      if (!files.length) {
        status.textContent = '';
        refresh().then(function () { toast(done + ' image' + (done === 1 ? '' : 's') + ' added'); });
        return;
      }
      var file = files.shift();
      status.textContent = 'Uploading ' + file.name + ' (' + (done + 1) + ' of ' + (done + 1 + files.length) + ')…';
      uploadOne(file, poolId).then(function () { done++; next(); })
        .catch(function (err) { status.textContent = ''; toast(err.message, true); });
    };
    next();
  };

  $('upload-input').onchange = function (event) {
    var file = event.target.files && event.target.files[0];
    if (!file) return;
    var status = $('upload-status');
    status.textContent = 'Uploading ' + file.name + '…';
    fetch('/_/api/upload?name=' + encodeURIComponent(file.name), {
      method: 'POST',
      headers: { 'x-skin-request': '1', 'content-type': file.type || 'application/octet-stream' },
      body: file
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Upload failed');
        return d;
      });
    }).then(function (data) {
      state = data.state;
      render();
      status.textContent = '';
      toast('Uploaded — pick temp or main below');
    }).catch(function (err) { status.textContent = ''; toast(err.message, true); });
    event.target.value = '';
  };

  $('splash-toggle').onchange = function (event) {
    act(api('splash', { on: event.target.checked }),
      event.target.checked ? 'Splash on' : 'Splash off');
  };

  $('logout').onclick = function () { $('logout-form').submit(); };

  /* ----------------------------------------------------------------- boot */

  function refresh() {
    return api('state').then(function (data) { state = data; render(); });
  }

  // A panel showing a phantom temp that already expired is worse than no panel.
  setInterval(refresh, 20000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refresh();
  });

  refresh().then(function () {
    var params = new URLSearchParams(location.search);
    if (params.get('reset') === '1') {
      act(api('temp', null, 'DELETE'), 'Reset to main');
      history.replaceState({}, '', '/_/');
    }
    showTab(location.hash.slice(1) || 'now');
  });
})();
`;
