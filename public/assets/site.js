(function () {
  function initLucideIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  }

  function setupSearchModal() {
    const modal = document.getElementById('search-modal');
    if (!modal) return;

    const openButtons = document.querySelectorAll('[data-search-open]');
    const closeElements = modal.querySelectorAll('[data-search-close]');
    const input = modal.querySelector('input[name="q"]');

    const open = () => {
      modal.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
      setTimeout(() => {
        if (input) {
          input.focus();
          input.select();
        }
        initLucideIcons();
      }, 50);
    };

    const close = () => {
      modal.classList.add('hidden');
      document.body.classList.remove('overflow-hidden');
    };

    openButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        open();
      });
    });

    closeElements.forEach((element) => {
      element.addEventListener('click', (event) => {
        event.preventDefault();
        close();
      });
    });

    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        close();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
        close();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    initLucideIcons();
    setupSearchModal();
  });

  window.addEventListener('load', initLucideIcons);
})();

