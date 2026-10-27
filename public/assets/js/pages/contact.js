/* COLA STUDIO — Contact */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;

  Cola.boot(function () {
    var s = Cola.data.settings || {}, so = s.social || {}, email = (s.brand && s.brand.email) || '';
    var greet = (s.whatsapp && s.whatsapp.greeting) || 'Hello Cola Studio';
    var ch = [];
    ch.push({ icon: 'whatsapp', title: 'WhatsApp', text: 'Orders, sizing and anything urgent.', cta: Cola.order.enabled() ? '<a class="btn btn--sm btn--wa" target="_blank" rel="noopener" href="' + esc(Cola.order.waLink(greet + ' 👋\n')) + '">' + Cola.icon('whatsapp', 'btn__icon') + 'Start a chat</a>' : '<span class="tiny subtle">Coming soon</span>', primary: true });
    ch.push({ icon: 'mail', title: 'Email', text: email || 'studio@colastudio.com', cta: email ? '<a class="btn btn--sm btn--ghost" href="mailto:' + esc(email) + '">Write an email</a>' : '' });
    ch.push({ icon: 'weibo', title: 'Weibo', text: 'News and drops from the studio.', cta: '<a class="btn btn--sm btn--ghost" href="' + esc(so.weibo || Cola.url('updates')) + '"' + (so.weibo ? ' target="_blank" rel="noopener"' : '') + '>' + (so.weibo ? 'Open Weibo' : 'Studio updates') + '</a>' });
    if (so.yupoo) ch.push({ icon: 'album', title: 'Yupoo', text: 'Photo albums of every piece.', cta: '<a class="btn btn--sm btn--ghost" href="' + esc(so.yupoo) + '" target="_blank" rel="noopener">Open Yupoo</a>' });
    $('[data-channels]').innerHTML = ch.map(function (c, i) {
      return '<article class="channel' + (c.primary ? ' channel--primary theme-dark' : '') + '"><span class="channel__icon">' + Cola.icon(c.icon) + '</span><h2 class="h4">' + c.title + '</h2><p class="small muted">' + esc(c.text) + '</p><div class="channel__cta">' + c.cta + '</div></article>';
    }).join('');
    var ref = Cola.param('ref'); if (ref) $('#c-ref').value = ref;
    var topic = Cola.param('topic'); if (topic) $$('#c-topic option').forEach(function (o) { if (o.textContent.toLowerCase().indexOf(topic.toLowerCase()) >= 0) o.selected = true; });

    var form = $('[data-contact-form]');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = true;
      $$('[required]', form).forEach(function (el) {
        var f = el.closest('.field'), bad = !el.value.trim() || (el.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(el.value.trim()));
        f.classList.toggle('has-error', bad); if (bad && ok) { el.focus(); ok = false; }
      });
      if (!ok) return Cola.ui.toast('Please fill in the highlighted fields', { icon: 'info' });
      var body = { name: form.name.value.trim(), email: form.email.value.trim(), topic: form.topic.value, message: (form.ref.value ? '[Order ' + form.ref.value.trim() + '] ' : '') + form.message.value.trim(), whatsapp: form.whatsapp.value.trim(), website: form.website.value };
      var btn = form.querySelector('[type=submit]'); btn.classList.add('is-loading');
      Cola.data.post('/api/contact', body).then(function (r) {
        btn.classList.remove('is-loading');
        if (r.ok) return done('Message received', 'Thank you, ' + esc(body.name.split(' ')[0]) + '. We usually reply within one or two working days' + (body.whatsapp ? ' — or sooner on WhatsApp' : '') + '.');
        if (r.offline) {
          // Static hosting: hand off to the visitor's mail app (or WhatsApp if there is no email configured)
          var text = 'Topic: ' + body.topic + '\nName: ' + body.name + '\nEmail: ' + body.email + (body.whatsapp ? '\nWhatsApp: ' + body.whatsapp : '') + '\n\n' + body.message;
          if (email) location.href = 'mailto:' + email + '?subject=' + encodeURIComponent(body.topic + ' — Cola Studio') + '&body=' + encodeURIComponent(text);
          else if (Cola.order.enabled()) Cola.openExternal(Cola.order.waLink(text));
          return done('Almost there', 'Your email app should have opened with the message ready to send.');
        }
        Cola.ui.toast(r.error || 'Something went wrong — please try WhatsApp or email.', { icon: 'info' });
      });
    });
    function done(title, text) {
      form.hidden = true;
      var d = $('[data-contact-done]'); d.hidden = false;
      d.innerHTML = '<div class="callout mt-4">' + Cola.icon('check') + '<div><b>' + title + '.</b> ' + text + '</div></div><button class="link mt-3" type="button" data-again>Send another message</button>';
      d.querySelector('[data-again]').addEventListener('click', function () { form.reset(); form.hidden = false; d.hidden = true; });
    }
  });
})();
