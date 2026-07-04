(function initializeThemedSelects(global) {
    'use strict';

    const enhancedSelects = new WeakMap();
    let optionSequence = 0;

    function getOptions(select) {
        return Array.from(select.options).map((option) => ({
            value: option.value,
            label: option.textContent.trim(),
            disabled: option.disabled
        }));
    }

    function setNativeValue(select, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(
            global.HTMLSelectElement.prototype,
            'value'
        )?.set;

        if (valueSetter) {
            valueSetter.call(select, value);
        } else {
            select.value = value;
        }

        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function enhanceSelect(select) {
        if (!(select instanceof global.HTMLSelectElement) || enhancedSelects.has(select)) {
            return;
        }

        const root = document.createElement('div');
        const button = document.createElement('button');
        const value = document.createElement('span');
        const arrow = document.createElement('span');
        const listbox = document.createElement('div');
        const listboxId = `artsoul-select-list-${++optionSequence}`;
        let activeIndex = Math.max(select.selectedIndex, 0);

        root.className = 'artsoul-themed-select';
        root.dataset.selectFor = select.id || select.name || listboxId;
        button.type = 'button';
        button.className = 'artsoul-themed-select__button';
        button.setAttribute('role', 'combobox');
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', listboxId);
        button.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Choose an option');
        value.className = 'artsoul-themed-select__value';
        arrow.className = 'artsoul-themed-select__arrow';
        arrow.setAttribute('aria-hidden', 'true');
        listbox.id = listboxId;
        listbox.className = 'artsoul-themed-select__listbox';
        listbox.setAttribute('role', 'listbox');
        listbox.hidden = true;

        button.append(value, arrow);
        root.append(button, listbox);
        select.classList.add('artsoul-themed-select__native');
        select.insertAdjacentElement('afterend', root);

        function isOpen() {
            return button.getAttribute('aria-expanded') === 'true';
        }

        function sync() {
            const selectedOption = select.options[select.selectedIndex] || select.options[0];
            value.textContent = selectedOption?.textContent.trim() || '';
            button.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Choose an option');
            button.disabled = select.disabled;
            root.classList.toggle('is-disabled', select.disabled);
            activeIndex = Math.max(select.selectedIndex, 0);

            Array.from(listbox.children).forEach((optionElement, index) => {
                const selected = index === select.selectedIndex;
                optionElement.setAttribute('aria-selected', String(selected));
                optionElement.classList.toggle('is-selected', selected);
            });
        }

        function renderOptions() {
            listbox.replaceChildren();
            getOptions(select).forEach((option, index) => {
                const optionElement = document.createElement('div');
                optionElement.id = `${listboxId}-option-${index}`;
                optionElement.className = 'artsoul-themed-select__option';
                optionElement.dataset.value = option.value;
                optionElement.textContent = option.label;
                optionElement.setAttribute('role', 'option');
                optionElement.setAttribute('aria-disabled', String(option.disabled));
                optionElement.addEventListener('pointerdown', (event) => {
                    event.preventDefault();
                });
                optionElement.addEventListener('click', () => {
                    if (!option.disabled) {
                        setNativeValue(select, option.value);
                        close();
                        button.focus();
                    }
                });
                listbox.append(optionElement);
            });
            sync();
        }

        function setActiveOption(index) {
            const options = Array.from(select.options);
            if (!options.length) return;

            let nextIndex = index;
            for (let attempts = 0; attempts < options.length; attempts += 1) {
                nextIndex = (nextIndex + options.length) % options.length;
                if (!options[nextIndex].disabled) break;
                nextIndex += index >= activeIndex ? 1 : -1;
            }

            activeIndex = Math.max(0, Math.min(nextIndex, options.length - 1));
            const activeOption = listbox.children[activeIndex];
            button.setAttribute('aria-activedescendant', activeOption?.id || '');
            activeOption?.scrollIntoView({ block: 'nearest' });

            Array.from(listbox.children).forEach((element, optionIndex) => {
                element.classList.toggle('is-active', optionIndex === activeIndex);
            });
        }

        function open() {
            if (select.disabled || isOpen()) return;
            document.dispatchEvent(new CustomEvent('artsoul-select-open', { detail: root }));
            listbox.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            root.classList.add('is-open');
            sync();
            setActiveOption(activeIndex);
        }

        function close() {
            if (!isOpen()) return;
            listbox.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.removeAttribute('aria-activedescendant');
            root.classList.remove('is-open');
        }

        button.addEventListener('click', () => {
            if (isOpen()) close();
            else open();
        });

        button.addEventListener('keydown', (event) => {
            const lastIndex = select.options.length - 1;
            if (event.key === 'Escape') {
                close();
                return;
            }
            if (event.key === 'Tab') {
                close();
                return;
            }
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (!isOpen()) {
                    open();
                } else if (!select.options[activeIndex]?.disabled) {
                    setNativeValue(select, select.options[activeIndex].value);
                    close();
                }
                return;
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                if (!isOpen()) open();
                if (event.key === 'Home') setActiveOption(0);
                else if (event.key === 'End') setActiveOption(lastIndex);
                else setActiveOption(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
            }
        });

        select.addEventListener('change', sync);
        select.form?.addEventListener('reset', () => global.setTimeout(sync, 0));
        document.addEventListener('artsoul-select-open', (event) => {
            if (event.detail !== root) close();
        });
        document.addEventListener('pointerdown', (event) => {
            if (!root.contains(event.target)) close();
        });

        const observer = new MutationObserver(() => {
            renderOptions();
        });
        observer.observe(select, {
            attributes: true,
            attributeFilter: ['disabled', 'data-artsoul-value', 'aria-label'],
            childList: true,
            subtree: true
        });

        enhancedSelects.set(select, { root, sync, observer });
        renderOptions();
    }

    function scan(root = document) {
        if (root instanceof global.HTMLSelectElement) {
            enhanceSelect(root);
            return;
        }
        root.querySelectorAll?.('select').forEach(enhanceSelect);
    }

    function initialize() {
        scan();
        const pageObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof global.Element) scan(node);
                });
            });
        });
        pageObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    global.ArtSoulThemedSelects = { enhance: enhanceSelect, scan };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})(window);
