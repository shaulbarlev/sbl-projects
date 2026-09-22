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
  var sheetTarget = null;
  var sheetOnDone = null;
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
    if (target.kind === 'giphy') return target.query ? 'GIF feed: ' + target.query : 'Trending GIF feed';
    if (target.kind === 'traffic') return 'Traffic light';
    return '“' + target.text + '”';
  }

  /** One line on the home agent and the lamps, for the Home card. */
  function homeStatus() {
    var home = state.home || {};
    if (!home.online) return 'Home agent offline';
    var states = home.states || {};
    return 'Home online · ' + (home.lights || []).map(function (l) {
      return l.label.toLowerCase() + ' ' + (states[l.entity] || '?');
    }).join(' · ');
  }

  function kindLabel(target) {
    if (!target) return '';
    if (target.kind === 'url') return 'link';
    if (target.kind === 'file') return 'file';
    if (target.kind === 'pool') return 'random image';
    if (target.kind === 'giphy') return 'gif feed';
    if (target.kind === 'traffic') return 'home';
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
    if (typeof closeSheet === 'function' && !$('sheet').hidden) closeSheet();
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

      row.appendChild(button('Send', '', function () { openSheet(entry.target); }));

      if (options.onDelete) {
        row.appendChild(button('✕', 'ghost', function () { options.onDelete(entry); }));
      }
      host.appendChild(row);
    });
  }

  /** The other domains: what each points at, and a way back to sbl.cx. */
  function renderDomains() {
    var hosts = state.domainHosts || [];
    var host = $('domains');
    host.innerHTML = '';
    hosts.forEach(function (name) {
      var slot = state.domains && state.domains[name];
      var row = document.createElement('div');
      row.className = 'item';
      var label = document.createElement('div');
      label.className = 'name';
      label.innerHTML = esc(name) + '<span class="sub">' +
        (slot ? '→ ' + esc(describe(slot.target)) : '→ sbl.cx') + '</span>';
      row.appendChild(label);
      if (slot) {
        row.appendChild(button('Back to sbl.cx', '', function () {
          act(api('domain/' + encodeURIComponent(name), null, 'DELETE'), name + ' → sbl.cx');
        }));
      }
      host.appendChild(row);
    });
    $('domains-hint').textContent = hosts.length ? '' : 'No other domains are configured.';

    // The sheet's buttons, one per domain.
    var sheet = $('sheet-domains');
    sheet.innerHTML = '';
    hosts.forEach(function (name) {
      sheet.appendChild(button('Point ' + name + ' here', '', function () {
        sheetAction(function (target) {
          return act(api('send', { slot: name, target: target }), name + ' set');
        });
      }));
    });
  }

  /**
   * A thumbnail for a target that is an image, or a set of them. A filename
   * says nothing about which picture a step will show; a set shows its first.
   */
  function thumbFor(target) {
    var key = null;
    if (target.kind === 'file') key = target.key;
    if (target.kind === 'pool') {
      var pool = findPool(target.poolId);
      key = pool ? pool.items[0] : null;
    }
    var file = key && state.files.filter(function (f) { return f.key === key; })[0];
    if (!file || !/^image\//.test(file.type)) return null;
    var img = document.createElement('img');
    img.className = 'preview';
    img.src = '/f/' + file.key + '/' + encodeURIComponent(file.name);
    img.alt = '';
    img.loading = 'lazy';
    return img;
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
      empty.textContent = 'No steps yet. Pick one in Destinations and choose "Add to sequence".';
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

      var preview = thumbFor(step.target);
      if (preview) row.appendChild(preview);

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
      var send = button('Send', '', function () { openSheet(target); });
      // A set with nothing in it cannot serve anything, so offering to point
      // the code at it would just be a way to break the QR.
      send.disabled = pool.items.length === 0;
      head.appendChild(send);
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
    $('sticky-toggle').checked = !!state.stickySteps;
    $('traffic-toggle').checked = !!state.trafficEnabled;
    $('traffic-send').disabled = !state.trafficEnabled;
    $('party-toggle').checked = !!state.partyEnabled;
    $('home-status').textContent = homeStatus();
    renderDomains();

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
        '\n\nThis persists until you change it.')) return null;
      return act(api('send', { slot: 'main', target: target }), 'Main set');
    }
    return act(api('send', { slot: 'temp', target: target, durationMs: duration * 60000 }),
      'Temporary for ' + duration + 'm');
  }

  /* ----------------------------------------------------------------- sheet */

  /**
   * Open the send sheet for a target.
   *
   * Everything that can be pointed at goes through here, so "where does this
   * go" is asked once, in one place, in thumb reach — rather than each list
   * growing its own pair of slot buttons and each slot growing its own
   * composer. onDone lets the caller clean up after a successful send; the
   * composer uses it to clear its inputs.
   */
  function openSheet(target, onDone) {
    if (!target) return;
    sheetTarget = target;
    sheetOnDone = onDone || null;
    $('sheet-target').innerHTML = esc(describe(target)) +
      '<span class="sub" id="sheet-kind">' + kindLabel(target) + '</span>';
    $('sheet-backdrop').hidden = false;
    $('sheet').hidden = false;
    // Next frame, so the transform transition has a start state to move from.
    requestAnimationFrame(function () { $('sheet').className = 'open'; });
  }

  function closeSheet() {
    $('sheet').className = '';
    $('sheet').hidden = true;
    $('sheet-backdrop').hidden = true;
    sheetTarget = null;
    sheetOnDone = null;
  }

  /** Run one of the sheet's actions, then close and let the caller tidy up. */
  function sheetAction(run) {
    if (!sheetTarget) return;
    var target = sheetTarget;
    var done = sheetOnDone;
    var result = run(target);
    closeSheet();
    if (done && result && result.then) result.then(done);
  }

  function currentCustomTarget() {
    if (customMode === 'message') {
      var text = $('custom-text').value.trim();
      return text ? { kind: 'text', text: text } : null;
    }
    var url = $('custom-url').value.trim();
    return url ? { kind: 'url', url: url } : null;
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

  /** The sheet's primary button states the duration it is about to commit. */
  function labelTempButton() {
    var minutes = duration;
    var text = minutes % 1440 === 0 ? (minutes / 1440) + 'd'
      : minutes % 60 === 0 ? (minutes / 60) + 'h'
      : minutes + 'm';
    $('sheet-temp').textContent = 'Set temporary \u00b7 ' + text;
  }

  pickGroup('[data-duration]', function (btn) {
    duration = Number(btn.dataset.duration);
    $('duration').value = btn.dataset.duration;
    labelTempButton();
  });
  pickGroup('[data-seqduration]', function (btn) {
    seqDuration = Number(btn.dataset.seqduration);
  });
  pickGroup('[data-mode]', function (btn) {
    customMode = btn.dataset.mode;
    $('custom-url').hidden = customMode !== 'link';
    $('custom-text').hidden = customMode !== 'message';
  });
  $('duration').oninput = function () {
    var value = Number($('duration').value);
    if (value > 0) { duration = value; labelTempButton(); }
  };

  $('custom-send').onclick = function () {
    var target = currentCustomTarget();
    if (!target) { toast('Nothing to send', true); return; }
    openSheet(target, function () {
      $('custom-url').value = '';
      $('custom-text').value = '';
    });
  };

  $('sheet-temp').onclick = function () {
    sheetAction(function (target) { return applyTarget(target, 'temp'); });
  };
  $('sheet-main').onclick = function () {
    // applyTarget returns null when the confirm is declined, so the sheet
    // closes without the composer being cleared behind a cancelled action.
    sheetAction(function (target) { return applyTarget(target, 'main'); });
  };
  $('sheet-seq').onclick = function () {
    sheetAction(function (target) {
      return act(api('send', { slot: 'sequence', target: target }), 'Added to sequence');
    });
  };
  $('sheet-close').onclick = closeSheet;
  $('sheet-backdrop').onclick = closeSheet;
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('sheet').hidden) closeSheet();
  });

  $('bm-add').onclick = function () {
    var label = $('bm-label');
    var url = $('bm-url');
    if (!url.value.trim()) { toast('URL required', true); return; }
    act(api('bookmarks', { label: label.value.trim(), target: { kind: 'url', url: url.value.trim() } }),
      'Bookmark added').then(function () { label.value = ''; url.value = ''; });
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
      toast('Uploaded — Send it from the list below');
    }).catch(function (err) { status.textContent = ''; toast(err.message, true); });
    event.target.value = '';
  };

  $('splash-toggle').onchange = function (event) {
    act(api('splash', { on: event.target.checked }),
      event.target.checked ? 'Splash on' : 'Splash off');
  };

  $('traffic-toggle').onchange = function (event) {
    act(api('traffic', { on: event.target.checked }),
      event.target.checked ? 'Traffic light on' : 'Traffic light off');
  };
  $('party-toggle').onchange = function (event) {
    act(api('party', { on: event.target.checked }),
      event.target.checked ? 'Party button on' : 'Party button off');
  };
  $('traffic-send').onclick = function () { openSheet({ kind: 'traffic' }); };

  $('sticky-toggle').onchange = function (event) {
    act(api('sequence/sticky', { on: event.target.checked }),
      event.target.checked ? 'Each device keeps its step' : 'Every scan advances');
  };

  /* ------------------------------------------------------------------ gifs */

  function searchGifs() {
    var host = $('gifs');
    var status = $('gif-status');
    host.innerHTML = '';
    status.textContent = 'Searching…';
    api('gifs?q=' + encodeURIComponent($('gif-q').value.trim())).then(function (data) {
      status.textContent = data.gifs.length ? '' : 'Nothing found.';
      data.gifs.forEach(function (gif) {
        var img = document.createElement('img');
        img.src = gif.preview;
        img.alt = gif.title;
        img.loading = 'lazy';
        var pick = button('', '', function () { importGif(gif); });
        pick.setAttribute('aria-label', 'Use ' + gif.title);
        pick.appendChild(img);
        host.appendChild(pick);
      });
    }).catch(function (err) { status.textContent = ''; toast(err.message, true); });
  }

  // Copied into Files first, so it becomes an ordinary file target and the
  // sheet can send it anywhere one goes. Cancelling the sheet leaves the
  // file in the Library; delete it there.
  function importGif(gif) {
    var status = $('gif-status');
    status.textContent = 'Saving ' + gif.title + '…';
    api('gifs/import', { url: gif.url, name: gif.title }).then(function (data) {
      state = data.state;
      render();
      status.textContent = '';
      openSheet({ kind: 'file', key: data.file.key, name: data.file.name });
    }).catch(function (err) { status.textContent = ''; toast(err.message, true); });
  }

  $('gif-search').onclick = searchGifs;
  $('gif-feed').onclick = function () {
    openSheet({ kind: 'giphy', query: $('gif-q').value.trim() });
  };
  $('gif-q').onkeydown = function (e) {
    if (e.key === 'Enter') { e.preventDefault(); searchGifs(); }
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
