(function(){
  var $ = function(id){ return document.getElementById(id); };

  // Tabs (WAI-ARIA tabs pattern, automatic activation)
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function groupOf(tab){ return Array.prototype.slice.call(tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')); }
  function select(tab, focus){
    groupOf(tab).forEach(function(t){
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function(tab){
    tab.addEventListener('click', function(){ select(tab, false); });
    tab.addEventListener('keydown', function(e){
      var g = groupOf(tab), i = g.indexOf(tab), n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % g.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + g.length) % g.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = g.length - 1;
      if (n !== null){ e.preventDefault(); select(g[n], true); }
    });
  });
  // Links that open a specific calculator on this page
  Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function(a){
    a.addEventListener('click', function(){ if ($(a.getAttribute('data-tool'))) select($(a.getAttribute('data-tool')), false); });
  });
  // Deep links from other pages, e.g. calculators.html#borrow, open that calculator's tab
  var TOOL_HASH = { '#stamp-duty':'tab-duty', '#borrow':'tab-afford', '#instalment':'tab-loan', '#sale-proceeds':'tab-sale', '#rental-yield':'tab-yield' };
  function openToolFromHash(){
    var t = $(TOOL_HASH[location.hash] || '');
    if (!t) return;
    select(t, false);
    var sec = t.closest('section');
    if (sec) requestAnimationFrame(function(){ sec.scrollIntoView(); });
  }
  openToolFromHash();
  window.addEventListener('hashchange', openToolFromHash);
  // Links that open a specific FAQ answer
  function openFaq(hash){
    var d = hash && hash.indexOf('#faq-') === 0 ? $(hash.slice(1)) : null;
    if (d && d.tagName === 'DETAILS') d.open = true;
  }
  Array.prototype.forEach.call(document.querySelectorAll('a[href^="#faq-"]'), function(a){
    a.addEventListener('click', function(){ openFaq(a.getAttribute('href')); });
  });
  openFaq(location.hash);

  // Number helpers
  function num(el){ var v = parseFloat(String(el.value).replace(/[^0-9.]/g, '')); return isFinite(v) ? v : 0; }
  function money(v){ return (v < 0 ? '−S$' : 'S$') + Math.round(Math.abs(v)).toLocaleString('en-SG'); }
  function pct(v){ return isFinite(v) ? v.toFixed(2) + '%' : '–'; }
  function tidy(el){ // add thousands separators to whole-dollar fields
    if (el.getAttribute('inputmode') !== 'numeric') return;
    var v = num(el); if (el.value.trim() !== '') el.value = Math.round(v).toLocaleString('en-SG');
  }
  function wire(form, fn){
    if (!form) return; // calculator not on this page
    form.addEventListener('input', function(){ fn(); });
    form.addEventListener('change', function(){ fn(); });
    form.addEventListener('submit', function(e){
      e.preventDefault();
      Array.prototype.forEach.call(form.querySelectorAll('input'), tidy);
      fn(true);
    });
    form.addEventListener('focusout', function(e){ if (e.target.tagName === 'INPUT') tidy(e.target); });
    fn();
  }

  // Stamp duty (IRAS rates checked 26 Nov 2026: BSD from 15 Feb 2023, ABSD from 27 Apr 2023)
  // Residential tops out at 6%; commercial and industrial at 5% on the amount above S$1M, with no ABSD.
  var BSD = {
    res: [[180000,.01],[180000,.02],[640000,.03],[500000,.04],[1500000,.05],[Infinity,.06]],
    non: [[180000,.01],[180000,.02],[640000,.03],[500000,.04],[Infinity,.05]]
  };
  var ABSD = { sc:[0,.20,.30], pr:[.05,.30,.35], fr:[.60,.60,.60] };
  var BUYER = { sc:'Singapore citizen', pr:'permanent resident', fr:'foreigner' };
  function bsd(p, tiers){ var d = 0, left = p; for (var i = 0; i < tiers.length && left > 0; i++){ var b = Math.min(left, tiers[i][0]); d += b * tiers[i][1]; left -= b; } return Math.floor(d); }
  wire($('duty'), function(fromButton){
    var res = $('d-type').value === 'res', p = num($('d-price'));
    $('d-buyer').disabled = $('d-count').disabled = !res;
    $('d-note').hidden = !res; $('d-note-non').hidden = res;
    var rate = res ? ABSD[$('d-buyer').value][+$('d-count').value - 1] : 0;
    var b = bsd(p, BSD[$('d-type').value]), a = Math.floor(p * rate);
    $('d-bsd').textContent = money(b);
    $('d-absd-label').textContent = res ? "Additional Buyer's Stamp Duty (ABSD) at " + Math.round(rate * 100) + '%' : "Additional Buyer's Stamp Duty (ABSD): not applicable";
    $('d-absd').textContent = money(a);
    $('d-total').textContent = money(b + a);
    $('d-total-fig').textContent = money(b + a);
    var st = $('d-status');
    if (fromButton){
      st.textContent = 'Total stamp duty: ' + money(b + a) + (res ? ', residential, ' + BUYER[$('d-buyer').value] + '.' : ', commercial or industrial.');
      st.setAttribute('data-set', '1');
    } else if (st.hasAttribute('data-set')){
      st.textContent = 'Figures also update as you change any option.';
      st.removeAttribute('data-set');
    }
  });

  // Monthly instalment with a rate-rise test
  function pmt(L, ratePct, years){ var n = years * 12, r = ratePct / 1200; if (n <= 0) return 0; return r === 0 ? L / n : L * r / (1 - Math.pow(1 + r, -n)); }
  function pv(M, ratePct, years){ var n = years * 12, r = ratePct / 1200; if (n <= 0 || M <= 0) return 0; return r === 0 ? M * n : M * (1 - Math.pow(1 + r, -n)) / r; }

  // Affordability with a bank loan (MAS rules checked 26 Nov 2026):
  // TDSR 55% of income for all debts; MSR 30% for property loans on HDB flats and ECs;
  // repayments assessed at the higher of the bank's rate or 4% (residential) / 5% (non-residential);
  // variable income counted at 70%; joint borrowers use income-weighted average age.
  // LTV for individuals: 75%/55%, 45%/25%, 35%/15% by outstanding housing loans; the lower figure applies
  // when tenure exceeds 30 years (25 for HDB flats) or runs past age 65. Max tenure 30 (HDB) / 35 years.
  var LTV = [[.75,.55],[.45,.25],[.35,.15]], MINCASH = [[.05,.10],[.25,.25],[.25,.25]];
  wire($('afford'), function(fromButton){
    var type = $('a-type').value, res = type !== 'non', joint = $('a-joint').value === '2';
    $('a-b2').hidden = !joint;
    $('a-loans-f').hidden = !res; $('a-ltv-f').hidden = res;
    $('a-msr-row').hidden = !(type === 'hdb' || type === 'ec');

    var inc1 = num($('a-fix1')) + .7 * num($('a-var1'));
    var inc2 = joint ? num($('a-fix2')) + .7 * num($('a-var2')) : 0;
    var inc = inc1 + inc2;
    var age = joint && inc > 0 ? (num($('a-age1')) * inc1 + num($('a-age2')) * inc2) / inc : num($('a-age1'));
    var maxTen = type === 'hdb' ? 30 : type === 'non' ? 30 : 35;
    var asked = num($('a-tenure')), ten = Math.min(asked, maxTen);
    var home = num($('a-home')), debts = home + num($('a-car')) + num($('a-other'));
    var tdsr = .55 * inc - debts, msr = .30 * inc - home;
    var avail = Math.max(0, (type === 'hdb' || type === 'ec') ? Math.min(tdsr, msr) : tdsr);
    var rate = num($('a-rate')), stress = Math.max(res ? 4 : 5, rate);
    var loan = Math.floor(pv(avail, stress, ten) / 1000) * 1000;

    var ltv, cashPct, why = [];
    if (res){
      var n = +$('a-loans').value, low = ten > (type === 'hdb' ? 25 : 30) || age + ten > 65;
      ltv = LTV[n][low ? 1 : 0]; cashPct = MINCASH[n][low ? 1 : 0];
      if (low){
        why.push('The lower loan-to-value applies because the tenure is over ' + (type === 'hdb' ? 25 : 30) + ' years or the loan runs past age 65 (borrower age used: ' + Math.round(age) + ').');
        var altTen = Math.min(type === 'hdb' ? 25 : 30, Math.floor(65 - age));
        if (altTen >= 5){
          var altLoan = Math.floor(pv(avail, stress, altTen) / 1000) * 1000;
          why.push('For the higher ' + Math.round(LTV[n][0] * 100) + '% loan, choose a tenure of ' + altTen + ' years or less: you could then borrow up to ' + money(altLoan) + ' for a price up to ' + money(Math.floor(altLoan / LTV[n][0] / 1000) * 1000) + '.');
        }
      }
      if (n > 0) why.push('With an existing home loan outstanding, the loan-to-value limit is lower and at least 25% must be paid in cash.');
    } else {
      ltv = Math.min(.95, Math.max(.05, num($('a-ltv')) / 100)); cashPct = 1 - ltv;
      why.push('Banks set their own loan limits for commercial and industrial property; change the percentage to match your offer. CPF generally cannot be used, so the downpayment is shown in cash.');
    }
    if (asked > maxTen) why.push('Tenure capped at ' + maxTen + ' years' + (type === 'non' ? ' here; banks set their own limits.' : ', the maximum for this property type.'));
    if (avail <= 0 && inc > 0) why.push('Existing repayments already use up the debt limit, so no new loan is shown.');
    if (type === 'hdb' || type === 'ec') why.push('HDB flats and ECs bought from the developer have their own eligibility rules, such as income ceilings, which are not checked here. An HDB loan follows HDB\'s rules instead.');

    var price = ltv > 0 ? Math.floor(loan / ltv / 1000) * 1000 : 0;
    $('a-loan').textContent = money(loan);
    $('a-price-label').textContent = 'Maximum purchase price with a ' + Math.round(ltv * 100) + '% loan';
    $('a-price').textContent = money(price);
    $('a-inc').textContent = money(inc);
    $('a-tdsr').textContent = money(Math.max(0, tdsr));
    $('a-msr').textContent = money(Math.max(0, msr));
    $('a-avail').textContent = money(avail);
    $('a-stress').textContent = stress.toFixed(2).replace(/\.?0+$/, '') + '%';
    $('a-ten').textContent = ten + ' years';
    $('a-ltv-out').textContent = Math.round(ltv * 100) + '%';
    // Instalment split for the first month: interest on the full loan, the rest repays principal.
    // Each later month a little more goes to principal as the balance falls.
    // Rounded so the two parts always add up to the instalment shown.
    var pay = Math.round(pmt(loan, rate, ten)), int1 = Math.min(pay, Math.round(loan * rate / 1200));
    $('a-pay').textContent = money(pay);
    $('a-pay-int').textContent = money(int1);
    $('a-pay-prin').textContent = money(pay - int1);
    $('a-why').textContent = why.join(' ');
    $('a-why').hidden = !why.length;

    var st = $('a-status');
    if (fromButton){
      st.textContent = 'Loan up to ' + money(loan) + '; purchase price up to ' + money(price) + ' with a ' + Math.round(ltv * 100) + '% loan.';
      st.setAttribute('data-set', '1');
    } else if (st.hasAttribute('data-set')){
      st.textContent = 'Figures also update as you change any option.';
      st.removeAttribute('data-set');
    }
  });
  wire($('panel-loan'), function(){
    var L = num($('l-amt')), y = num($('l-years')), m = pmt(L, num($('l-rate')), y), t = pmt(L, num($('l-test')), y);
    $('l-pay').textContent = money(m);
    $('l-test-pay').textContent = money(t);
    $('l-diff').textContent = money(t - m);
    $('l-int').textContent = money(Math.max(0, m * y * 12 - L));
  });

  // Sale proceeds
  wire($('panel-sale'), function(){
    var p = num($('s-price')), out = num($('s-loan')) + num($('s-costs')) + num($('s-ssd')) + num($('s-penalty')), cpf = num($('s-cpf'));
    var cash = p - out - cpf;
    $('s-cash').textContent = money(cash);
    $('s-r-price').textContent = money(p);
    $('s-r-out').textContent = money(-out);
    $('s-r-cpf').textContent = money(cpf);
    $('s-r-cash').textContent = money(cash);
    $('s-warn').textContent = cash < 0
      ? 'The sale does not cover the loan, costs and CPF refund. You may need to top up the shortfall in cash; talk to your bank and CPF Board early.'
      : 'Your CPF statement shows the exact refund, including accrued interest. Your bank can tell you any penalty for repaying early.';
  });

  // Rental yield
  wire($('panel-yield'), function(){
    var p = num($('y-price')), rent = num($('y-rent')), vac = Math.min(12, num($('y-vac'))), costs = num($('y-costs'));
    var coll = rent * (12 - vac), inc = coll - costs;
    $('y-gross').textContent = p ? pct(rent * 12 / p * 100) : '–';
    $('y-net').textContent = p ? pct(inc / p * 100) : '–';
    $('y-coll').textContent = money(coll);
    $('y-inc').textContent = money(inc);
  });

  // Combined PDF of both quick checks.
  // Builds a real PDF file with jsPDF (loaded from cdnjs only when the calculators come into view),
  // so it downloads in browsers that ignore the print window. Falls back to the print window if it can't load.
  function esc(t){ return String(t).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function inputsOf(form){
    var rows = [];
    Array.prototype.forEach.call(form.querySelectorAll('.f'), function(f){
      var h = f.closest('[hidden]');
      if (h && h !== form && form.contains(h)) return; // skip fields hidden inside the form, not the hidden tab itself
      var el = f.querySelector('input,select'); if (!el || el.disabled) return;
      var legend = f.closest('fieldset') ? f.closest('fieldset').querySelector('legend').textContent + ': ' : '';
      rows.push([legend + f.querySelector('label').textContent, el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : el.value]);
    });
    return rows;
  }
  function resultsOf(table){
    var rows = [];
    Array.prototype.forEach.call(table.rows, function(r){ if (!r.hidden) rows.push([r.cells[0].textContent, r.cells[1].textContent, r.className === 'total']); });
    return rows;
  }
  function notesOf(ids){ return ids.map(function(id){ var n = $(id); return n && !n.hidden ? n.textContent.trim() : ''; }).filter(Boolean); }
  var CONTACT_LINES = ['Esther Txe', 'CEA R060284E', 'esthertxe@gmail.com', '(65) 8800 8787'];
  var DISCLAIMER = 'Information in this document is general in nature and is not legal, tax or financial advice. Figures are illustrative; please consult the relevant professionals before deciding.';
  var BANK = 'Estimate only. The final loan amount and purchase price are subject to the bank\'s approval, including its own credit assessment, income documents and valuation of the property. Stamp duty, legal fees and other costs are not included in the loan figures. MAS rules and IRAS rates checked on 26 November 2026.';

  function reportData(){
    Array.prototype.forEach.call(document.querySelectorAll('#duty input, #afford input'), tidy);
    $('duty').dispatchEvent(new Event('change')); $('afford').dispatchEvent(new Event('change'));
    var now = new Date();
    return {
      today: now.toLocaleDateString('en-SG', { day:'numeric', month:'long', year:'numeric' }),
      iso: now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2),
      sections: [
        { title: '1. Stamp duty on a purchase', key: [['Total stamp duty', $('d-total').textContent]],
          inputs: inputsOf($('duty')), results: resultsOf($('duty').querySelector('table')), notes: notesOf(['d-note', 'd-note-non']) },
        { title: '2. How much I can borrow', key: [['Loan you may be eligible for', $('a-loan').textContent], [$('a-price-label').textContent, $('a-price').textContent]],
          inputs: inputsOf($('afford')), results: resultsOf($('afford').querySelector('table')), notes: notesOf(['a-why']), bank: true }
      ]
    };
  }

  // Fallback: the print window, for when jsPDF cannot load
  function printReport(d){
    var contact = '<address class="pr-contact"><strong>' + esc(CONTACT_LINES[0]) + '</strong><br>' + CONTACT_LINES.slice(1).map(esc).join('<br>') + '</address>';
    function table(rows){ return '<table>' + rows.map(function(r){ return '<tr' + (r[2] ? ' class="total"' : '') + '><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>'; }
    $('print-report').innerHTML =
      '<div class="pr-head"><div><h1>Know the numbers <em>before you commit</em></h1><p class="pr-date">Prepared on ' + esc(d.today) + ' with the calculators at www.esthertxe.com</p></div>' + contact + '</div>' +
      d.sections.map(function(s){
        return '<div class="pr-sec"><h2>' + esc(s.title) + '</h2><div class="pr-key">' + s.key.map(function(k){ return '<p>' + esc(k[0]) + '<strong>' + esc(k[1]) + '</strong></p>'; }).join('') + '</div>' +
          '<h3>Your inputs</h3>' + table(s.inputs) + '<h3>Results</h3>' + table(s.results) +
          s.notes.map(function(n){ return '<p class="pr-note">' + esc(n) + '</p>'; }).join('') +
          (s.bank ? '<p class="pr-note"><strong>' + esc(BANK) + '</strong></p>' : '') + '</div>';
      }).join('') +
      '<div class="pr-foot"><p>' + esc(DISCLAIMER) + '</p><p class="pr-cta">To go through these numbers together, contact me:</p>' + contact + '</div>';
    var title = document.title;
    document.title = 'Esther Txe - Stamp duty and borrowing - ' + d.today;
    window.addEventListener('afterprint', function restore(){ document.title = title; window.removeEventListener('afterprint', restore); });
    window.print();
  }

  // Real PDF file with jsPDF
  function plain(t){ // keep to characters the built-in PDF fonts can show
    return String(t).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—−]/g, '-')
      .replace(/…/g, '...').replace(/ /g, ' ').replace(/[^\x20-\x7E -ÿ]/g, '');
  }
  function buildPdf(d){
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' });
    var X0 = 16, X1 = 194, BOTTOM = 282, y = 20;
    var OLIVE = [93, 88, 57], INK = [34, 34, 34], GREY = [90, 90, 90], RULE = [200, 200, 200];
    function font(style, size, color, family){ doc.setFont(family || 'helvetica', style); doc.setFontSize(size); doc.setTextColor.apply(doc, color); }
    function rule(yy, color, w){ doc.setDrawColor.apply(doc, color); doc.setLineWidth(w || .2); doc.line(X0, yy, X1, yy); }
    function room(h){ if (y + h > BOTTOM){ doc.addPage(); y = 20; } }
    function para(text, size, color, style, lh){
      font(style || 'normal', size, color);
      var lines = doc.splitTextToSize(plain(text), X1 - X0);
      lines.forEach(function(l){ room(lh); doc.text(l, X0, y); y += lh; });
    }
    function rows(list){
      list.forEach(function(r){
        font(r[2] ? 'bold' : 'normal', 9.5, INK);
        var label = doc.splitTextToSize(plain(r[0]), X1 - X0 - 50), h = Math.max(1, label.length) * 4.2 + 2.6;
        room(h);
        rule(y, r[2] ? INK : RULE, r[2] ? .35 : .2);
        doc.text(label, X0, y + 4.4);
        doc.text(plain(r[1]), X1, y + 4.4, { align: 'right' });
        y += h;
      });
    }
    function contact(x, yy, align){
      CONTACT_LINES.forEach(function(l, i){ font(i ? 'normal' : 'bold', 9.5, INK); doc.text(l, x, yy + i * 4.6, { align: align }); });
    }

    // Header: title and date on the left, contact block on the right
    contact(X1, 18, 'right');
    font('bold', 17, INK); doc.text('KNOW THE NUMBERS', X0, 27);
    var tw = doc.getTextWidth('KNOW THE NUMBERS ');
    font('italic', 17, OLIVE, 'times'); doc.text('before you commit', X0 + tw, 27);
    font('normal', 9, GREY); doc.text(plain('Prepared on ' + d.today + ' with the calculators at www.esthertxe.com'), X0, 33.5);
    y = 37; rule(y, OLIVE, .5); y += 9;

    d.sections.forEach(function(s, si){
      if (si) room(60);
      font('bold', 11.5, OLIVE); doc.text(plain(s.title).toUpperCase(), X0, y); y += 7;
      // key figures side by side
      room(14);
      s.key.forEach(function(k, i){
        var x = X0 + i * 75;
        font('normal', 9, GREY); doc.text(plain(k[0]), x, y);
        font('bolditalic', 17, OLIVE, 'times'); doc.text(plain(k[1]), x, y + 7.5);
      });
      y += 17;
      font('bold', 8, GREY); room(8); doc.text('YOUR INPUTS', X0, y); y += 2.5; rows(s.inputs);
      y += 4; font('bold', 8, GREY); room(8); doc.text('RESULTS', X0, y); y += 2.5; rows(s.results);
      y += 3;
      s.notes.forEach(function(n){ para(n, 8, GREY, 'normal', 3.6); y += 1.2; });
      if (s.bank){ para(BANK, 8, INK, 'bold', 3.6); }
      y += 8;
    });

    room(36);
    rule(y, RULE, .2); y += 5;
    para(DISCLAIMER, 8, GREY, 'normal', 3.6);
    y += 2.5; room(26);
    font('normal', 9, INK); doc.text('To go through these numbers together, contact me:', X0, y); y += 5.5;
    contact(X0, y, 'left');
    return doc;
  }

  var pdfLib = null;
  function loadPdfLib(){
    if (window.jspdf) return Promise.resolve();
    if (!pdfLib) pdfLib = new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.async = true; s.crossOrigin = 'anonymous';
      s.onload = function(){ window.jspdf ? resolve() : reject(); };
      s.onerror = function(){ pdfLib = null; reject(); };
      document.head.appendChild(s);
    });
    return pdfLib;
  }
  var pdfBtn = $('pdf-btn'), pdfHint = $('pdf-hint');
  // Load the library ahead of time once the calculators are on screen, so the click downloads straight away
  if (pdfBtn && 'IntersectionObserver' in window){
    var pre = new IntersectionObserver(function(es){ if (es.some(function(e){ return e.isIntersecting; })){ loadPdfLib().catch(function(){}); pre.disconnect(); } }, { rootMargin: '400px' });
    pre.observe($('numbers'));
  }
  if (pdfBtn) pdfBtn.addEventListener('pointerenter', function(){ loadPdfLib().catch(function(){}); });
  if (pdfBtn) pdfBtn.addEventListener('click', function(){
    var d = reportData();
    function save(){
      try {
        buildPdf(d).save('Esther-Txe-stamp-duty-and-borrowing-' + d.iso + '.pdf');
        pdfHint.textContent = 'Your PDF has been downloaded. If you cannot find it, check your Downloads folder.';
      } catch (e) { printReport(d); }
    }
    if (window.jspdf) return save();
    pdfBtn.disabled = true; pdfBtn.textContent = 'Preparing PDF…';
    loadPdfLib().then(save, function(){ printReport(d); }).then(function(){
      pdfBtn.disabled = false; pdfBtn.textContent = 'Download both as PDF';
    });
  });

  // Chat nudge: hidden while the page header, a contact section or the footer is on screen; can be closed for the visit
  var nudge = $('nudge'), closed = false;
  try { closed = sessionStorage.getItem('nudgeClosed') === '1'; } catch (e) {}
  if (nudge) nudge.querySelector('.nudge-x').addEventListener('click', function(){
    closed = true; nudge.hidden = true;
    try { sessionStorage.setItem('nudgeClosed', '1'); } catch (e) {}
  });
  if (nudge && 'IntersectionObserver' in window){
    var showing = new Set();
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){ en.isIntersecting ? showing.add(en.target) : showing.delete(en.target); });
      nudge.hidden = closed || showing.size > 0;
    });
    Array.prototype.forEach.call(document.querySelectorAll('.hero, .page-head, .contact, .foot'), function(el){ io.observe(el); });
  }

  // Enquiry form -> mailto
  var form = document.getElementById('enquiry');
  if (form) form.addEventListener('submit', function(e){
    e.preventDefault();
    var name = form.name.value.trim(), contact = form.contact.value.trim();
    if (!name){ form.name.focus(); form.name.setAttribute('aria-invalid','true'); return; }
    if (!contact){ form.contact.focus(); form.contact.setAttribute('aria-invalid','true'); return; }
    var body = 'Name: ' + name + '\nPhone or email: ' + contact + '\nTopic: ' + form.topic.value + '\n\n' + form.message.value.trim();
    var href = 'mailto:esthertxe@gmail.com?subject=' + encodeURIComponent('Property enquiry from ' + name) + '&body=' + encodeURIComponent(body);
    form.setAttribute('data-mailto', href);
    window.location.href = href;
  });
  if (form) ['name','contact'].forEach(function(k){ form[k].addEventListener('input', function(){ this.removeAttribute('aria-invalid'); }); });
})();
