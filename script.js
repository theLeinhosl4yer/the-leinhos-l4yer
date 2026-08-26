    (() => {
      const root = document.documentElement;
      const langButtons = document.querySelectorAll('[data-lang]');
      const titles = {
        de: 'The Leinhos L4yer — Patrick Leinhos',
        en: 'The Leinhos L4yer — Patrick Leinhos'
      };

      function setLanguage(lang) {
        root.dataset.language = lang;
        root.lang = lang;
        document.title = titles[lang];
        langButtons.forEach(button => {
          button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
        });
      }

      langButtons.forEach(button => button.addEventListener('click', () => setLanguage(button.dataset.lang)));
      setLanguage('de');
      document.getElementById('year').textContent = new Date().getFullYear();

      const contactDialog = document.getElementById('contact-dialog');
      const contactForm = document.getElementById('contact-form');
      const formStatus = document.getElementById('form-status');
      const submitButton = document.getElementById('contact-submit');
      const startedField = document.getElementById('form-started');
      const openContactButtons = document.querySelectorAll('[data-open-contact]');
      const closeContactButton = document.querySelector('[data-close-contact]');
      let turnstileWidgetId = null;
      let turnstileToken = '';

      function openContact() {
        if (!contactDialog || contactDialog.open) return;
        contactDialog.showModal();
        document.body.classList.add('modal-open');
        if (startedField) startedField.value = String(Date.now());
        const renderTurnstile = () => {
          if (!window.turnstile || turnstileWidgetId !== null) return false;
          turnstileWidgetId = window.turnstile.render('#turnstile-container', {
            sitekey: '0x4AAAAAAEXipTWIHWrSI09M',
            theme: 'dark',
            action: 'contact',
            responseField: false,
            callback: token => {
              turnstileToken = token;
              formStatus.textContent = '';
              formStatus.className = 'form-status';
            },
            'expired-callback': () => { turnstileToken = ''; },
            'error-callback': () => {
              turnstileToken = '';
              const lang = root.dataset.language || 'de';
              formStatus.textContent = lang === 'de' ? 'Die Bot-Prüfung konnte nicht geladen werden.' : 'The bot check could not be loaded.';
              formStatus.className = 'form-status error';
            }
          });
          return true;
        };
        if (!renderTurnstile()) {
          let attempts = 0;
          const waitForTurnstile = window.setInterval(() => {
            attempts += 1;
            if (renderTurnstile() || attempts >= 40) window.clearInterval(waitForTurnstile);
          }, 100);
        }
        window.setTimeout(() => document.getElementById('contact-name')?.focus(), 60);
      }

      function closeContact() {
        if (contactDialog?.open) contactDialog.close();
      }

      openContactButtons.forEach(button => button.addEventListener('click', openContact));
      closeContactButton?.addEventListener('click', closeContact);
      contactDialog?.addEventListener('close', () => document.body.classList.remove('modal-open'));
      contactDialog?.addEventListener('click', event => {
        const rect = contactDialog.getBoundingClientRect();
        const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
        if (outside) closeContact();
      });

      if (contactForm) {
        contactForm.addEventListener('submit', async event => {
          event.preventDefault();
          const lang = root.dataset.language || 'de';
          formStatus.className = 'form-status';

          if (!contactForm.checkValidity()) {
            contactForm.reportValidity();
            formStatus.textContent = lang === 'de' ? 'Bitte prüfe die markierten Pflichtfelder.' : 'Please check the required fields.';
            formStatus.classList.add('error');
            return;
          }

          const formData = new FormData(contactForm);
          const payload = Object.fromEntries(formData.entries());
          payload.turnstile_token = turnstileToken || (window.turnstile && turnstileWidgetId !== null ? window.turnstile.getResponse(turnstileWidgetId) : '');
          if (!payload.turnstile_token) {
            formStatus.textContent = lang === 'de' ? 'Bitte schließe die Bot-Prüfung ab.' : 'Please complete the bot check.';
            formStatus.classList.add('error');
            return;
          }

          submitButton.disabled = true;
          formStatus.textContent = lang === 'de' ? 'Nachricht wird sicher übermittelt …' : 'Sending your message securely …';

          try {
            const response = await fetch('/api/contact', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify(payload)
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.code || 'request_failed');

            contactForm.reset();
            startedField.value = String(Date.now());
            turnstileToken = '';
            if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
            formStatus.textContent = lang === 'de' ? 'Nachricht wurde übermittelt. Vielen Dank.' : 'Your message has been sent. Thank you.';
            formStatus.classList.add('success');
          } catch (error) {
            const retry = error.message === 'rate_limited';
            formStatus.textContent = lang === 'de'
              ? (retry ? 'Zu viele Anfragen. Bitte versuche es später erneut.' : 'Die Nachricht konnte nicht übermittelt werden. Bitte versuche es später erneut.')
              : (retry ? 'Too many requests. Please try again later.' : 'The message could not be sent. Please try again later.');
            formStatus.classList.add('error');
            turnstileToken = '';
            if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
          } finally {
            submitButton.disabled = false;
          }
        });
      }

      const revealItems = document.querySelectorAll('.reveal');
      if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const observer = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('visible');
              observer.unobserve(entry.target);
            }
          });
        }, { threshold: 0.12 });
        revealItems.forEach(item => observer.observe(item));
      } else {
        revealItems.forEach(item => item.classList.add('visible'));
      }

      const stage = document.querySelector('.layer-stage');
      const layers = [...document.querySelectorAll('.tech-layer')];
      const canMove = window.matchMedia('(pointer: fine)').matches && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (stage && canMove) {
        stage.addEventListener('pointermove', event => {
          const rect = stage.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width - 0.5;
          const y = (event.clientY - rect.top) / rect.height - 0.5;
          layers.forEach((layer, index) => {
            const depth = (layers.length - index) * 5;
            layer.style.setProperty('--tx', `${x * depth}px`);
            layer.style.setProperty('--ty', `${y * depth}px`);
          });
        });
        stage.addEventListener('pointerleave', () => {
          layers.forEach(layer => {
            layer.style.setProperty('--tx', '0px');
            layer.style.setProperty('--ty', '0px');
          });
        });
      }
    })();
