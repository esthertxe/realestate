// Filters for /listings.html. Every card carries data-* attributes; filters live in the URL hash so links can open a filtered view.
(function(){
  var form = document.getElementById('filters'), grid = document.getElementById('results');
  if (!form || !grid) return;
  var cards = Array.prototype.slice.call(grid.children), order = cards.slice();
  var count = document.getElementById('fcount'), none = document.getElementById('fnone'), more = document.getElementById('fmore');
  var STEP = 48, shown = STEP, keys = ['q', 'page', 'deal', 'kind', 'zone', 'region', 'min', 'max', 'sort'];
  function num(v){ var n = parseFloat(String(v || '').replace(/[^\d.]/g, '')); return isNaN(n) ? null : n; }
  function fmt(n){ return n.toLocaleString('en-SG'); }

  function readHash(){
    var p = new URLSearchParams(location.hash.slice(1));
    keys.forEach(function(k){ if (form[k]) form[k].value = p.get(k) || ''; });
  }
  function writeHash(){
    var p = new URLSearchParams();
    keys.forEach(function(k){ var v = form[k].value.trim(); if (v) p.set(k, v); });
    var s = p.toString();
    history.replaceState(null, '', s ? '#' + s : location.pathname + location.search);
  }

  function apply(resetPaging){
    if (resetPaging) shown = STEP;
    var q = form.q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var f = { page: form.page.value, deal: form.deal.value, kind: form.kind.value, zone: form.zone.value, region: form.region.value };
    var min = num(form.min.value), max = num(form.max.value), sort = form.sort.value;
    var list = order.filter(function(c){
      var d = c.dataset;
      if (f.page && d.page !== f.page) return false;
      if (f.deal && d.deal !== f.deal) return false;
      if (f.kind && d.kind !== f.kind) return false;
      if (f.zone && d.zone !== f.zone) return false;
      if (f.region && d.region !== f.region) return false;
      var size = +d.size;
      if (min !== null && size < min) return false;
      if (max !== null && size > max) return false;
      for (var i = 0; i < q.length; i++) if (d.text.indexOf(q[i]) < 0) return false;
      return true;
    });
    if (sort){
      var by = sort.split('-')[0], dir = sort.split('-')[1] === 'desc' ? -1 : 1;
      list.sort(function(a, b){
        var x = by === 'psf' ? num(a.dataset.psf) : +a.dataset.size, y = by === 'psf' ? num(b.dataset.psf) : +b.dataset.size;
        if (x === null && y === null) return 0;
        if (x === null) return 1;   // rent on request goes last
        if (y === null) return -1;
        return (x - y) * dir;
      });
    }
    cards.forEach(function(c){ c.hidden = true; });
    list.forEach(function(c, i){ grid.appendChild(c); c.hidden = i >= shown; });
    count.textContent = fmt(list.length) + (list.length === 1 ? ' listing' : ' listings');
    none.hidden = list.length > 0;
    more.hidden = list.length <= shown;
    more.textContent = 'Show more (' + fmt(list.length - Math.min(shown, list.length)) + ' left)';
  }

  form.addEventListener('input', function(){ writeHash(); apply(true); });
  form.addEventListener('change', function(){ writeHash(); apply(true); });
  form.addEventListener('reset', function(){ setTimeout(function(){ writeHash(); apply(true); }, 0); });
  more.addEventListener('click', function(){ shown += STEP; apply(false); });
  window.addEventListener('hashchange', function(){ readHash(); apply(true); });
  readHash();
  apply(true);
})();
