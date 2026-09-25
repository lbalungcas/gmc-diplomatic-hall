/**
 * Innovator & Booth Guidelines Subpage Logic
 * Youth Innovations Marketplace
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. TABS MANAGEMENT
  const tabPills = document.querySelectorAll('.tab-pill-btn');
  const panels = document.querySelectorAll('.guideline-panel');
  const quickJumpSelect = document.getElementById('guidelinesQuickJump');

  const switchTab = (targetTabId, updateHash = true) => {
    // Update tab pills
    tabPills.forEach(pill => {
      const isTarget = pill.getAttribute('data-tab') === targetTabId;
      pill.classList.toggle('active', isTarget);
      pill.setAttribute('aria-selected', isTarget ? 'true' : 'false');
    });

    // Update panels
    panels.forEach(panel => {
      const isTarget = panel.id === `panel-${targetTabId}`;
      panel.classList.toggle('active', isTarget);
    });

    // Toggle sidebar TOC according to active tab
    const boothToc = document.getElementById('sidebar-booth-toc');
    const selectionToc = document.getElementById('sidebar-selection-toc');
    if (boothToc && selectionToc) {
      boothToc.style.display = targetTabId === 'booth' ? 'block' : 'none';
      selectionToc.style.display = targetTabId === 'selection' ? 'block' : 'none';
    }

    // Update quick jump selector options if needed
    if (quickJumpSelect) {
      const currentOptGroup = quickJumpSelect.querySelector(`optgroup[data-tab="${targetTabId}"]`);
      if (currentOptGroup) {
        quickJumpSelect.value = '';
      }
    }

    // Update URL hash
    if (updateHash) {
      history.replaceState(null, null, `#tab-${targetTabId}`);
    }
  };

  tabPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const targetTab = pill.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  // Handle URL hash on load
  const hash = window.location.hash;
  if (hash) {
    if (hash.includes('selection') || hash.includes('rubric') || hash.includes('criteria') || hash.includes('eligibility')) {
      switchTab('selection', false);
    } else if (hash.includes('booth') || hash.includes('checklist') || hash.includes('specs') || hash.includes('video')) {
      switchTab('booth', false);
    }

    // Scroll to specific section if hash points to an ID
    const targetElement = document.querySelector(hash);
    if (targetElement) {
      setTimeout(() => {
        targetElement.scrollIntoView({ behavior: 'smooth' });
      }, 150);
    }
  }

  // Quick jump dropdown
  if (quickJumpSelect) {
    quickJumpSelect.addEventListener('change', (e) => {
      const targetId = e.target.value;
      if (!targetId) return;

      const targetElement = document.getElementById(targetId);
      if (targetElement) {
        // Find which panel contains this element
        const parentPanel = targetElement.closest('.guideline-panel');
        if (parentPanel) {
          const tabId = parentPanel.id.replace('panel-', '');
          switchTab(tabId, false);
        }
        targetElement.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  // 2. STICKY HEADER & BACK TO TOP
  const header = document.getElementById('mainHeader');
  const backToTopBtn = document.getElementById('backToTopBtn');

  window.addEventListener('scroll', () => {
    const scrollY = window.pageYOffset;
    if (header) {
      header.classList.toggle('scrolled', scrollY > 50);
    }
    if (backToTopBtn) {
      backToTopBtn.classList.toggle('visible', scrollY > 500);
    }
  }, { passive: true });

  // 3. INTERACTIVE SUBMISSION CHECKLIST WITH LOCALSTORAGE
  const checklistItems = document.querySelectorAll('.checklist-item');
  const checklistCounter = document.getElementById('checklistCounter');
  const resetChecklistBtn = document.getElementById('resetChecklistBtn');
  const STORAGE_KEY = 'yim_booth_checklist_state_v1';

  // Load saved state
  let savedState = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) savedState = JSON.parse(raw);
  } catch (err) {
    console.warn('LocalStorage not available', err);
  }

  const updateChecklistCounter = () => {
    const total = checklistItems.length;
    let checkedCount = 0;
    checklistItems.forEach(item => {
      const checkbox = item.querySelector('input[type="checkbox"]');
      if (checkbox && checkbox.checked) {
        checkedCount++;
        item.classList.add('checked');
      } else {
        item.classList.remove('checked');
      }
    });

    if (checklistCounter) {
      checklistCounter.textContent = `${checkedCount} of ${total} Ready`;
      if (checkedCount === total) {
        checklistCounter.style.background = '#dcfce7';
        checklistCounter.style.color = '#166534';
      } else {
        checklistCounter.style.background = 'var(--vewu-yellow-light)';
        checklistCounter.style.color = 'var(--vewu-blue)';
      }
    }
  };

  // Initialize checkboxes from saved state
  checklistItems.forEach((item, index) => {
    const checkbox = item.querySelector('input[type="checkbox"]');
    if (checkbox) {
      if (savedState[`item_${index}`]) {
        checkbox.checked = true;
      }

      // Checkbox direct change
      checkbox.addEventListener('change', () => {
        savedState[`item_${index}`] = checkbox.checked;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));
        } catch (e) {}
        updateChecklistCounter();
      });

      // Clicking anywhere on the item row
      item.addEventListener('click', (e) => {
        if (e.target !== checkbox) {
          checkbox.checked = !checkbox.checked;
          savedState[`item_${index}`] = checkbox.checked;
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState));
          } catch (e) {}
          updateChecklistCounter();
        }
      });
    }
  });

  updateChecklistCounter();

  // Reset checklist button
  if (resetChecklistBtn) {
    resetChecklistBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to reset all checklist items?')) {
        savedState = {};
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch (e) {}
        checklistItems.forEach(item => {
          const checkbox = item.querySelector('input[type="checkbox"]');
          if (checkbox) checkbox.checked = false;
        });
        updateChecklistCounter();
      }
    });
  }

  // 4. COPY TEXT TO CLIPBOARD BUTTONS
  const copyButtons = document.querySelectorAll('.copy-badge-btn');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const textToCopy = btn.getAttribute('data-copy');
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
          const originalText = btn.innerHTML;
          btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
          btn.style.color = '#16a34a';
          setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.color = '';
          }, 2000);
        }).catch(err => {
          console.error('Failed to copy', err);
        });
      }
    });
  });

  // 5. PRINT / SAVE AS PDF
  const printBtns = document.querySelectorAll('.btn-print-guide');
  printBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      window.print();
    });
  });

  // 6. MOBILE DRAWER NAVIGATION
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

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && mobileDrawer.classList.contains('open')) {
        closeDrawer();
      }
    });
  }
});
