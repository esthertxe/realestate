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
  var TOOL_HASH = { '#stamp-duty':'tab-duty', '#borrow':'tab-afford', '#cashflow':'tab-cash', '#instalment':'tab-cash', '#sale-proceeds':'tab-sale', '#rental-yield':'tab-cash' };
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
  // Monthly cashflow on a rented property
  wire($('panel-cash'), function(){
    var L = Math.round(num($('c-price')) * Math.min(100, num($('c-ltv'))) / 100);
    $('c-loan').value = L.toLocaleString('en-SG');
    var rent = num($('c-rent')), rate = num($('c-rate')), mcst = num($('c-mcst')), tax = num($('c-tax'));
    var pay = Math.round(pmt(L, rate, num($('c-years')))), int1 = Math.min(pay, Math.round(L * rate / 1200)), prin = pay - int1;
    var net = rent - pay - mcst - tax, word = net >= 0 ? 'Positive' : 'Negative';
    $('c-label').textContent = word + ' cashflow a month';
    $('c-r-label').textContent = word + ' cashflow a month';
    $('c-net').textContent = money(net);
    $('c-r-rent').textContent = money(rent);
    $('c-r-pay').textContent = money(-pay);
    $('c-r-mcst').textContent = money(-mcst);
    $('c-r-tax').textContent = money(-tax);
    $('c-r-net').textContent = money(net);
    $('c-note').textContent = 'Of the ' + money(pay) + ' instalment, about ' + money(prin) + ' is principal (about ' + money(int1) +
      ' is interest). The principal portion is still being paid by the tenant’s rent, and it reduces your loan amount, so part of the instalment builds your equity rather than being a cost.';

    // Rental yield from the same figures (before the loan)
    var p = num($('c-price')), up = num($('c-upkeep'));
    var coll = rent * 12, inc = coll - mcst * 12 - tax * 12 - up;
    mcst *= 12; tax *= 12;
    $('y-gross').textContent = p ? pct(rent * 12 / p * 100) : '–';
    $('y-net').textContent = p ? pct(inc / p * 100) : '–';
    $('y-coll').textContent = money(coll);
    $('y-r-mcst').textContent = money(-mcst);
    $('y-r-tax').textContent = money(-tax);
    $('y-r-upkeep').textContent = money(-up);
    $('y-inc').textContent = money(inc);
  });

  // Sale proceeds
  // Seller's Stamp Duty (IRAS rates checked 28 Nov 2026), by holding period: up to 1 year, more than 1 and up to 2, and so on.
  // Charged on the selling price or market value, whichever is higher, rounded down to the dollar.
  var SSD = {
    r25: { rates: [16, 12, 8, 4], name: 'residential bought on or after 4 Jul 2025' },
    r17: { rates: [12, 8, 4], name: 'residential bought 11 Mar 2017 to 3 Jul 2025' },
    ind: { rates: [15, 10, 5], name: 'industrial' },
    com: { rates: [], name: 'commercial' }
  };
  wire($('panel-sale'), function(){
    var p = num($('s-price')), loan = num($('s-loan')), costs = num($('s-costs')), pen = num($('s-penalty')), cpf = num($('s-cpf'));
    var heldRaw = $('s-held').value.trim(), held = num($('s-held')), t = SSD[$('s-bought').value];
    var rate = 0, status;
    if (!t.rates.length) status = 'No SSD: commercial property (office, retail) is not subject to SSD.';
    else if (heldRaw === '') status = 'Enter how long you have owned the property to work out any SSD.';
    else {
      var i = Math.max(0, Math.ceil(held) - 1);
      if (i < t.rates.length){
        rate = t.rates[i];
        status = 'SSD at ' + rate + '% (' + t.name + ', owned ' + held + (held === 1 ? ' year' : ' years') + '). IRAS charges SSD on the selling price or market value, whichever is higher; this uses the selling price.';
      } else status = 'No SSD: owned more than ' + t.rates.length + ' years (' + t.name + ').';
    }
    var ssd = Math.floor(p * rate / 100), cash = p - loan - costs - ssd - pen - cpf;
    $('s-cash').textContent = money(cash);
    $('s-r-price').textContent = money(p);
    $('s-r-loan').textContent = money(-loan);
    $('s-r-costs').textContent = money(-costs);
    $('s-r-ssd-label').textContent = 'Less Seller’s Stamp Duty' + (rate ? ' (' + rate + '%)' : '');
    $('s-r-ssd').textContent = money(-ssd);
    $('s-r-pen').textContent = money(-pen);
    $('s-r-cpf').textContent = money(-cpf);
    $('s-r-cash').textContent = money(cash);
    $('s-ssd-status').textContent = status;
    $('s-warn').textContent = cash < 0
      ? 'The sale does not cover the loan, costs and CPF refund. You may need to top up the shortfall in cash; talk to your bank and CPF Board early.'
      : 'Your CPF statement shows the exact refund, including accrued interest. Your bank can tell you any penalty for repaying early.';

  });

  // PDF reports: stamp duty and borrowing; rental cashflow and yield.
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
  var CONTACT_LINES = ['Esther Txe', 'CEA R060284E', 'List International Realty Pte Ltd', 'Agency Licence L3010762D', 'esthertxe@gmail.com', '(65) 8800 8787'];
  var DISCLAIMER = 'Information in this document is general in nature and is not legal, tax or financial advice. Figures are illustrative; please consult the relevant professionals before deciding.';
  var BANK = 'Estimate only. The final loan amount and purchase price are subject to the bank\'s approval, including its own credit assessment, income documents and valuation of the property. Stamp duty, legal fees and other costs are not included in the loan figures. MAS rules and IRAS rates checked on 26 November 2026.';

  // Two separate reports: 'numbers' (stamp duty and borrowing) and 'own' (rental cashflow and yield)
  function reportData(kind){
    var forms = kind === 'listing' ? [] : kind === 'own' ? ['panel-cash'] : kind === 'sale' ? ['panel-sale'] : ['duty', 'afford'];
    forms.forEach(function(id){
      Array.prototype.forEach.call($(id).querySelectorAll('input:not([readonly])'), tidy);
      $(id).dispatchEvent(new Event('change'));
    });
    var now = new Date(), d = {
      today: now.toLocaleDateString('en-SG', { day:'numeric', month:'long', year:'numeric' }),
      iso: now.getFullYear() + '-' + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('0' + now.getDate()).slice(-2)
    };
    if (kind === 'listing'){
      // Fact sheet for one listing, read from the page
      var lt = document.querySelector('[data-listing]');
      var dl = function(sel){ return Array.prototype.map.call(document.querySelectorAll(sel), function(div){ return [div.querySelector('dt').textContent, div.querySelector('dd').textContent]; }); };
      var hl = Array.prototype.map.call(document.querySelectorAll('.highlights li'), function(li){ return li.textContent; });
      d.head = [lt.querySelector('h1').firstChild.textContent.trim(), lt.querySelector('h1 em').textContent];
      d.file = lt.getAttribute('data-listing'); d.name = d.head[0]; d.sub = 'Fact sheet prepared on ' + d.today + ' from www.esthertxe.com';
      d.sections = [{ title: lt.querySelector('.page-lead').textContent, key: [[lt.querySelector('.status-chip').textContent, $('l-price').textContent]],
        inputs: [], results: dl('#facts > div'), resultsLabel: 'Key details', notes: hl.length ? ['Highlights: ' + hl.join('; ') + '.'] : [] }];
      if ($('movein-table')) d.sections.push({ title: 'Cost to move in', key: [], inputs: [], results: resultsOf($('movein-table')), resultsLabel: 'Estimate',
        notes: notesOf([]).concat([$('movein-table').nextElementSibling.textContent.trim()]) });
      d.sections[d.sections.length - 1].notes.push(document.querySelector('.foot').textContent.match(/Listing details as at[^.]*\./)[0]);
      return d;
    }
    if (kind === 'sale'){
      d.head = ['Run your', 'own numbers']; d.file = 'sale-proceeds'; d.name = 'Sale proceeds';
      d.sections = [
        { title: 'Sale proceeds', key: [['Cash in hand after the sale', $('s-cash').textContent]],
          inputs: inputsOf($('panel-sale')), results: resultsOf($('s-table')), notes: notesOf(['s-ssd-status', 's-warn']) }
      ];
    } else if (kind === 'own'){
      d.head = ['Run your', 'own numbers']; d.file = 'rental-cashflow-and-yield'; d.name = 'Rental cashflow and yield';
      d.sections = [
        { title: '1. Monthly cashflow on a rented property', key: [[$('c-label').textContent, $('c-net').textContent]],
          inputs: inputsOf($('panel-cash')), results: resultsOf($('c-table')), notes: notesOf(['c-note']) },
        { title: '2. Rental yield', key: [['Gross rental yield', $('y-gross').textContent], ['Net rental yield', $('y-net').textContent]],
          inputs: [], results: resultsOf($('y-table')), notes: notesOf(['y-note']) }
      ];
    } else {
      d.head = ['Know the numbers', 'before you commit']; d.file = 'stamp-duty-and-borrowing'; d.name = 'Stamp duty and borrowing';
      d.sections = [
        { title: '1. Stamp duty on a purchase', key: [['Total stamp duty', $('d-total').textContent]],
          inputs: inputsOf($('duty')), results: resultsOf($('duty').querySelector('table')), notes: notesOf(['d-note', 'd-note-non']) },
        { title: '2. How much I can borrow', key: [['Loan you may be eligible for', $('a-loan').textContent], [$('a-price-label').textContent, $('a-price').textContent]],
          inputs: inputsOf($('afford')), results: resultsOf($('afford').querySelector('table')), notes: notesOf(['a-why']), bank: true }
      ];
    }
    return d;
  }

  // Fallback: the print window, for when jsPDF cannot load
  function printReport(d){
    var contact = '<address class="pr-contact"><strong>' + esc(CONTACT_LINES[0]) + '</strong><br>' + CONTACT_LINES.slice(1).map(esc).join('<br>') + '</address>';
    function table(rows){ return '<table>' + rows.map(function(r){ return '<tr' + (r[2] ? ' class="total"' : '') + '><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table>'; }
    $('print-report').innerHTML =
      '<div class="pr-head"><div><h1>' + esc(d.head[0]) + ' <em>' + esc(d.head[1]) + '</em></h1><p class="pr-date">' + esc(d.sub || ('Prepared on ' + d.today + ' with the calculators at www.esthertxe.com')) + '</p></div>' + contact + '</div>' +
      d.sections.map(function(s){
        return '<div class="pr-sec"><h2>' + esc(s.title) + '</h2><div class="pr-key">' + s.key.map(function(k){ return '<p>' + esc(k[0]) + '<strong>' + esc(k[1]) + '</strong></p>'; }).join('') + '</div>' +
          (s.inputs.length ? '<h3>Your inputs</h3>' + table(s.inputs) : '') + '<h3>' + esc(s.resultsLabel || 'Results') + '</h3>' + table(s.results) +
          s.notes.map(function(n){ return '<p class="pr-note">' + esc(n) + '</p>'; }).join('') +
          (s.bank ? '<p class="pr-note"><strong>' + esc(BANK) + '</strong></p>' : '') + '</div>';
      }).join('') +
      '<div class="pr-foot"><p>' + esc(DISCLAIMER) + '</p><p class="pr-cta">To go through these numbers together, contact me:</p>' + contact + '</div>';
    var title = document.title;
    document.title = 'Esther Txe - ' + d.name + ' - ' + d.today;
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
      CONTACT_LINES.forEach(function(l, i){ font(i ? 'normal' : 'bold', 9, INK); doc.text(l, x, yy + i * 4.3, { align: align }); });
    }

    // Header: title and date on the left, contact block on the right
    contact(X1, 13, 'right');
    // Title on the left, shrunk if needed so it never runs into the contact block on the right
    var h0 = d.head[0].toUpperCase(), size = 17, tw, w1;
    do {
      font('bold', size, INK); tw = doc.getTextWidth(h0 + ' ');
      font('italic', size, OLIVE, 'times'); w1 = doc.getTextWidth(d.head[1]);
    } while (tw + w1 > 100 && (size -= 1) > 10);
    font('bold', size, INK); doc.text(h0, X0, 27);
    font('italic', size, OLIVE, 'times'); doc.text(d.head[1], X0 + tw, 27);
    font('normal', 9, GREY); doc.text(plain(d.sub || ('Prepared on ' + d.today + ' with the calculators at www.esthertxe.com')), X0, 33.5);
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
      if (s.inputs.length){ font('bold', 8, GREY); room(8); doc.text('YOUR INPUTS', X0, y); y += 2.5; rows(s.inputs); y += 4; }
      font('bold', 8, GREY); room(8); doc.text((s.resultsLabel || 'Results').toUpperCase(), X0, y); y += 2.5; rows(s.results);
      y += 3;
      s.notes.forEach(function(n){ para(n, 8, GREY, 'normal', 3.6); y += 1.2; });
      if (s.bank){ para(BANK, 8, INK, 'bold', 3.6); }
      y += 8;
    });

    room(36);
    rule(y, RULE, .2); y += 5;
    para(DISCLAIMER, 8, GREY, 'normal', 3.6);
    y += 2.5; room(32);
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
  var pdfBtns = document.querySelectorAll('[data-pdf]');
  // Load the library ahead of time once the calculators are on screen, so the click downloads straight away
  if (pdfBtns.length && 'IntersectionObserver' in window){
    var pre = new IntersectionObserver(function(es){ if (es.some(function(e){ return e.isIntersecting; })){ loadPdfLib().catch(function(){}); pre.disconnect(); } }, { rootMargin: '400px' });
    pre.observe($('numbers') || pdfBtns[0]);
  }
  Array.prototype.forEach.call(pdfBtns, function(pdfBtn){
    var pdfHint = $(pdfBtn.getAttribute('aria-describedby')), label = pdfBtn.textContent;
    pdfBtn.addEventListener('pointerenter', function(){ loadPdfLib().catch(function(){}); });
    pdfBtn.addEventListener('click', function(){
      var d = reportData(pdfBtn.getAttribute('data-pdf'));
      function save(){
        try {
          buildPdf(d).save('Esther-Txe-' + d.file + '-' + d.iso + '.pdf');
          if (pdfHint) pdfHint.textContent = 'Your PDF has been downloaded. If you cannot find it, check your Downloads folder.';
        } catch (e) { printReport(d); }
      }
      if (window.jspdf) return save();
      pdfBtn.disabled = true; pdfBtn.textContent = 'Preparing PDF…';
      loadPdfLib().then(save, function(){ printReport(d); }).then(function(){
        pdfBtn.disabled = false; pdfBtn.textContent = label;
      });
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

  // Calculators opened from a listing: calculators.html?price=1850000&type=res&rent=4500#stamp-duty
  (function(){
    if (!$('duty') || !window.URLSearchParams) return;
    var q = new URLSearchParams(location.search), p = parseInt(q.get('price'), 10), rent = parseInt(q.get('rent'), 10);
    if (!(p > 0)) return;
    var fmt = function(n){ return n.toLocaleString('en-SG'); };
    $('d-price').value = fmt(p);
    if (q.get('type') === 'non' || q.get('type') === 'res') $('d-type').value = q.get('type');
    $('c-price').value = fmt(p);
    if (rent > 0) $('c-rent').value = fmt(rent);
    ['duty', 'panel-cash'].forEach(function(id){ $(id).dispatchEvent(new Event('change')); });
    $('d-type').dispatchEvent(new Event('change', { bubbles: true }));
  })();

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
