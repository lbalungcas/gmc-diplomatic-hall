/**
 * Youth Innovations Marketplace - JavaScript Logic
 * Optimized with requestAnimationFrame for smooth 60fps scrolling, 
 * interactive agenda filtering, real-time endorsement counter, and accessible modal handling.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. OPTIMIZED STICKY HEADER & SCROLLSPY (requestAnimationFrame throttled)
  const header = document.getElementById('mainHeader');
  const backToTopBtn = document.getElementById('backToTopBtn');
  const navLinks = document.querySelectorAll('.nav-link');
  const sections = document.querySelectorAll('section[id]');
  let ticking = false;

  const onScroll = () => {
    const scrollY = window.pageYOffset;

    // Header shadow & back to top button visibility
    if (scrollY > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }

    if (backToTopBtn) {
      if (scrollY > 500) {
        backToTopBtn.classList.add('visible');
      } else {
        backToTopBtn.classList.remove('visible');
      }
    }

    // Scrollspy active anchor detection with getBoundingClientRect
    let currentSection = '';
    const headerHeight = header ? header.offsetHeight : 76;

    sections.forEach(section => {
      const rect = section.getBoundingClientRect();
      if (rect.top <= headerHeight + 80 && rect.bottom >= headerHeight + 80) {
        currentSection = section.getAttribute('id');
      }
    });

    if (currentSection) {
      navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${currentSection}`) {
          link.classList.add('active');
        }
      });
    }

    ticking = false;
  };

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(onScroll);
      ticking = true;
    }
  }, { passive: true });

  // 2. MOBILE DRAWER NAVIGATION
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const mobileDrawer = document.getElementById('mobileDrawer');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');

  if (mobileMenuBtn && mobileDrawer) {
    const openDrawer = () => {
      mobileDrawer.classList.add('open');
      document.body.style.overflow = 'hidden';
    };

    const closeDrawer = () => {
      mobileDrawer.classList.remove('open');
      document.body.style.overflow = '';
    };

    mobileMenuBtn.addEventListener('click', openDrawer);
    if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);

    mobileNavLinks.forEach(link => {
      link.addEventListener('click', closeDrawer);
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileDrawer.classList.contains('open')) {
        closeDrawer();
      }
    });
  }

  // 3. AGENDA TABS (Marketplace Day, Youth Prep Workshop, Deal Corner)
  const agendaTabs = document.querySelectorAll('.agenda-tab');
  const agendaPanes = document.querySelectorAll('.agenda-tab-pane');

  agendaTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      agendaTabs.forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      const targetTabId = tab.getAttribute('data-tab');
      agendaPanes.forEach(pane => {
        if (pane.id === `pane-${targetTabId}`) {
          pane.classList.add('active');
        } else {
          pane.classList.remove('active');
        }
      });
    });
  });

  // 4. CALL TO ACTION ENDORSEMENT FORM (OPTIONAL COMPONENT)
  const endorseForm = document.getElementById('endorseForm');
  if (endorseForm) {
    const endorsementCountEl = document.getElementById('endorsementCount');
    let count = parseInt(localStorage.getItem('yim_endorse_count') || '1428', 10);
    if (endorsementCountEl) {
      endorsementCountEl.textContent = count.toLocaleString();
    }

    endorseForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('endorserName');
      const orgInput = document.getElementById('endorserOrg');
      const roleInput = document.getElementById('endorserRole');
      const trackInput = document.getElementById('endorseTrack');

      const name = nameInput ? nameInput.value.trim() : '';
      const org = orgInput ? orgInput.value.trim() : '';
      const role = roleInput ? roleInput.value : '';
      const track = trackInput ? trackInput.value : '';

      if (!name || !org || !role) return;

      count += 1;
      localStorage.setItem('yim_endorse_count', count.toString());
      if (endorsementCountEl) {
        endorsementCountEl.textContent = count.toLocaleString();
      }

      showToast(
        'Action Endorsed!',
        `Thank you ${name} (${org}) for championing the youth recommendations on ${track}.`
      );

      endorseForm.reset();
    });
  }

  // 6. TOAST NOTIFICATION
  let toastTimer = null;
  function showToast(title, message) {
    const toast = document.getElementById('toastNotification');
    const toastTitle = document.getElementById('toastTitle');
    const toastMessage = document.getElementById('toastMessage');

    if (!toast) return;

    if (toastTitle) toastTitle.textContent = title;
    if (toastMessage) toastMessage.textContent = message;

    toast.classList.add('show');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 4500);
  }
});
