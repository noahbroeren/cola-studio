/* COLA STUDIO — How to order */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, esc = Cola.esc;

  Cola.boot(function () {
    var s = Cola.data.settings || {};
    // agents
    var agents = Cola.order.agents();
    $('[data-agent-cards]').innerHTML = agents.length ? agents.map(function (a, i) {
      var url = a.urlTemplate && !/\{(weidianUrl|itemId|slug|name)\}/.test(a.urlTemplate) ? a.urlTemplate : '';
      return '<article class="agent-card"><div class="agent__mark">' + esc((a.name || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase()) + '</div>' +
        '<div><h3 class="h4">' + esc(a.name) + (a.recommended ? ' <span class="badge badge--accent">Recommended</span>' : '') + '</h3><p class="small muted mt-1">' + esc(a.description || '') + '</p></div>' +
        (url ? '<a class="btn btn--ghost btn--sm" href="' + esc(url) + '" target="_blank" rel="noopener">Visit ' + Cola.icon('external', 'btn__icon') + '</a>' : '<span class="tiny subtle">Use the button on each product</span>') + '</article>';
    }).join('') : '<p class="muted">Agent options will appear here soon.</p>';
    // shipping
    var sh = s.shipping || {};
    $('[data-ship-note]').textContent = sh.note || 'Shipping times are indicative and depend on the line you choose.';
    $('[data-ship-rows]').innerHTML = (sh.regions || []).map(function (r) { return '<tr><td>' + esc(r.region) + '</td><td class="ta-r">' + esc(r.time) + '</td></tr>'; }).join('');
  });
})();
