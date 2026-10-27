/* COLA STUDIO — Contact */
(function () {
  'use strict';
  var Cola = window.Cola, $ = Cola.$, $$ = Cola.$$, esc = Cola.esc;

  Cola.boot(function () {
    var s = Cola.data.settings || {}, email = (s.brand && s.brand.email) || '';
    // WhatsApp, email and Weibo always; Discord, Weidian and Yupoo when a link is set (Admin → Settings → Social links)
    var ch = Cola.c.channelList(['whatsapp', 'email', 'weibo', 'discord', 'weidian', 'yupoo']).filter(function (c) { return ['whatsapp', 'email', 'weibo'].indexOf(c.key) >= 0 || c.href; });
    $('[data-channels]').innerHTML = ch.map(Cola.c.channelCard).join('');
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
