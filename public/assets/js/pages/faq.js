/* COLA STUDIO — FAQ (edit the questions in the FAQ array below) */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;
  var FAQ = [
    { id: 'ordering', title: 'Ordering', items: [
      ['How do I place an order?', 'Add pieces to your order list, open the order page and press “Send order on WhatsApp”. We pre-fill a message with every item, size, quantity and an order reference. The studio confirms availability and shipping, and you pay once everything is confirmed.'],
      ['Do I need an account?', 'No. Your order list, saved items and details are stored on your own device. Nothing is charged on this website.'],
      ['Can I order without WhatsApp?', 'Yes — use the “Copy message” button on the order page and send it by email or Instagram, or order through an agent using the agent button on each product.'],
      ['Can I change my order after sending it?', 'As long as it has not been paid and packed, simply reply in the same WhatsApp chat with the change.'],
      ['Do you offer pre-orders?', 'Some styles are produced in numbered runs and sold as pre-order. The product page shows the expected shipping date, and pre-order items ship together with the rest of your order unless you ask us to split it.']
    ] },
    { id: 'agents', title: 'Agents', items: [
      ['What is a buying agent?', 'An agent buys products from Chinese marketplaces like Weidian on your behalf, stores them in a warehouse, sends you quality-control photos and ships everything to you in one parcel.'],
      ['Which agents can I use?', 'Every product page lists the agents we work with. If your favourite agent is not listed, copy the product link — most agents accept Weidian links directly.'],
      ['Are prices the same through an agent?', 'The item price is the same as in our Weidian store. Your agent may add their own service and shipping fees.']
    ] },
    { id: 'payment', title: 'Payment & currency', items: [
      ['In which currency do I pay?', 'Our store currency is Chinese yuan (CNY). Prices in EUR, USD or GBP are converted at a recent exchange rate and are indicative. The exact total is confirmed before you pay.'],
      ['Which payment methods do you accept?', 'We agree on a secure payment method in the WhatsApp chat once your order is confirmed. When ordering through an agent, you pay the agent using their methods.'],
      ['When do I pay?', 'Only after the studio has confirmed availability, shipping and the total amount.']
    ] },
    { id: 'shipping', title: 'Shipping', items: [
      ['Do you ship worldwide?', 'Yes. See the shipping table on the How to order page for indicative delivery times per region.'],
      ['How much does shipping cost?', 'Shipping depends on weight, destination and the line you choose. The order page shows an estimated parcel weight; we quote the exact price in the chat.'],
      ['Will I get a tracking number?', 'Always. Tracking is shared in the same WhatsApp conversation as soon as your parcel leaves.'],
      ['Do I have to pay import duties?', 'Depending on your country, customs duties or VAT may apply on arrival. These are set by your local customs authority and are not included in our prices.']
    ] },
    { id: 'sizing', title: 'Sizing & fit', items: [
      ['How do Cola Studio pieces fit?', 'Most tops are cut boxy and oversized with dropped shoulders. Every product page lists the intended fit and exact garment measurements.'],
      ['How do I find my size?', 'Measure a garment you love lying flat and compare it to our size chart, or use the fit finder on the size guide page.'],
      ['Are the measurements garment or body measurements?', 'Garment measurements, laid flat. “½” means measured across the front — double it for the full circumference.']
    ] },
    { id: 'returns', title: 'Returns & exchanges', items: [
      ['Can I exchange a size?', 'Contact us within 7 days of delivery with your order reference. Exchanges depend on stock and the item must be unworn with labels attached. Return shipping is at the customer\'s expense.'],
      ['What if my item arrives damaged?', 'Send photos in your WhatsApp chat within 48 hours of delivery and we will make it right.'],
      ['I ordered through an agent — who handles returns?', 'Agents usually handle returns while the item is still in their warehouse. Check the QC photos carefully before shipping.']
    ] },
    { id: 'stock', title: 'Stock & restocks', items: [
      ['How accurate is the live stock?', 'Stock is synchronised automatically with our Weidian store. Numbers can change between sending your order and our confirmation, which is why we always confirm first.'],
      ['Will a sold-out item come back?', 'Core styles are restocked regularly. Use “Notify me” on the product page and we will message you when your size is back.'],
      ['Where do I hear about new drops?', 'On the Studio updates page — posts from our Weibo are translated automatically — and through drop alerts on WhatsApp.']
    ] },
    { id: 'care', title: 'Product care', items: [
      ['How should I wash heavyweight cotton?', 'Cold, inside out, and lay flat to dry. Our terry is pre-shrunk, but tumble drying can still affect the shape.'],
      ['How do I care for knitwear?', 'Hand wash cold with a wool detergent and dry flat in shape. Store folded, never on a hanger.'],
      ['How do I care for waxed canvas?', 'Spot clean only and re-wax seasonally. The wax develops character with wear.']
    ] }
  ];

  Cola.boot(function () {
    var nav = $('[data-faq-nav]'), list = $('[data-faq-list]');
    nav.innerHTML = FAQ.map(function (c, i) { return '<a href="#' + c.id + '" data-faq-link="' + c.id + '"' + (i ? '' : ' class="is-on"') + '><span class="index">0' + (i + 1) + '</span>' + c.title + '</a>'; }).join('');
    list.innerHTML = FAQ.map(function (c, i) {
      return '<section class="faq-cat" id="' + c.id + '" data-faq-cat><h2 class="h3"><span class="index">0' + (i + 1) + '</span> ' + c.title + '</h2><div class="acc mt-3" data-acc>' + c.items.map(function (q) {
        return '<div class="acc__item" data-q="' + esc((q[0] + ' ' + q[1]).toLowerCase()) + '"><button class="acc__btn" type="button"><span>' + esc(q[0]) + '</span><span class="acc__plus" aria-hidden="true"></span></button><div class="acc__panel"><div><div class="acc__content">' + esc(q[1]) + '</div></div></div></div>';
      }).join('') + '</div></section>';
    }).join('');
    var total = FAQ.reduce(function (a, c) { return a + c.items.length; }, 0);
    $('[data-faq-count]').textContent = total + ' questions in ' + FAQ.length + ' topics';
    $('[data-faq-q]').addEventListener('input', Cola.debounce(function (e) {
      var q = e.target.value.trim().toLowerCase(), n = 0;
      $$('[data-q]').forEach(function (it) { var hit = !q || q.split(/\s+/).every(function (t) { return it.getAttribute('data-q').indexOf(t) >= 0; }); it.hidden = !hit; if (hit) n++; if (q && hit) it.classList.add('is-open'); if (!q) it.classList.remove('is-open'); });
      $$('[data-faq-cat]').forEach(function (c) { c.hidden = !$$('[data-q]:not([hidden])', c).length; });
      $('[data-faq-count]').textContent = q ? n + ' matching question' + (n === 1 ? '' : 's') : total + ' questions in ' + FAQ.length + ' topics';
    }, 120));
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) { en.forEach(function (e) { if (e.isIntersecting) $$('[data-faq-link]').forEach(function (a) { a.classList.toggle('is-on', a.getAttribute('data-faq-link') === e.target.id); }); }); }, { rootMargin: '-30% 0px -60% 0px' });
      $$('[data-faq-cat]').forEach(function (c) { io.observe(c); });
    }
  });
})();
