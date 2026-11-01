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
        if (!(select instanceof global.HTMLSelectElement) || enhancedSelects.has(select)
            || select.multiple || select.size > 1) {
            return;
        }

        const root = document.createElement('div');
        const button = document.createElement('button');
        const value = document.createElement('span');
        const arrow = document.createElement('span');
        const listbox = document.createElement('div');
        const listboxId = `artsoul-select-list-${++optionSequence}`;
        let activeIndex = Math.max(select.selectedIndex, 0);
        let releasePosition;
        const labelIds = Array.from(select.labels || []).map((label, index) => {
            if (!label.id) label.id = `${listboxId}-label-${index}`;
            return label.id;
        }).join(' ');

        root.className = 'artsoul-themed-select';
        root.dataset.selectFor = select.id || select.name || listboxId;
        button.type = 'button';
        button.tabIndex = select.tabIndex;
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
        select.insertAdjacentElement('afterend', root);

        function isOpen() {
            return button.getAttribute('aria-expanded') === 'true';
        }

        function clearPosition() {
            for (const property of ['top', 'left', 'width', 'maxHeight']) listbox.style[property] = '';
        }

        function positionListbox() {
            if (!isOpen()) return;
            if (!root.isConnected) return close();
            if (global.getComputedStyle(listbox).position !== 'fixed') {
                clearPosition();
                return;
            }
            const viewport = global.visualViewport;
            const positive = value => Number.isFinite(value) && value > 0;
            const width = positive(viewport?.width) ? viewport.width : global.innerWidth;
            const height = positive(viewport?.height) ? viewport.height : global.innerHeight;
            const offsetLeft = Number.isFinite(viewport?.offsetLeft) ? viewport.offsetLeft : 0;
            const offsetTop = Number.isFinite(viewport?.offsetTop) ? viewport.offsetTop : 0;
            const rect = button.getBoundingClientRect();
            if (!positive(width) || !positive(height) || width <= 24 || height <= 24
                || ![rect.left, rect.right, rect.top, rect.bottom, rect.width].every(Number.isFinite)
                || rect.width <= 0 || rect.bottom <= offsetTop || rect.top >= offsetTop + height
                || rect.right <= offsetLeft || rect.left >= offsetLeft + width) return close();

            const left = offsetLeft + 12;
            const top = offsetTop + 12;
            const popupWidth = Math.min(rect.width, width - 24);
            listbox.style.width = `${popupWidth}px`;
            const desiredHeight = Math.min(360, height * 0.6,
                listbox.scrollHeight + listbox.offsetHeight - listbox.clientHeight);
            const below = Math.max(0, offsetTop + height - 12 - rect.bottom - 7);
            const above = Math.max(0, rect.top - 7 - top);
            const opensAbove = below < desiredHeight && above > below;
            const popupHeight = Math.min(desiredHeight, opensAbove ? above : below);
            if (!positive(popupHeight) || popupHeight < Math.min(44, desiredHeight)) return close();
            listbox.style.maxHeight = `${popupHeight}px`;
            listbox.style.left = `${Math.max(left, Math.min(rect.left, offsetLeft + width - 12 - popupWidth))}px`;
            listbox.style.top = `${Math.max(top, Math.min(opensAbove ? rect.top - 7 - popupHeight : rect.bottom + 7,
                offsetTop + height - 12 - popupHeight))}px`;
        }

        function bindPosition() {
            const viewport = global.visualViewport;
            const update = event => {
                if (event.target !== listbox) positionListbox();
            };
            global.addEventListener('scroll', update, true);
            global.addEventListener('resize', update);
            viewport?.addEventListener('scroll', update);
            viewport?.addEventListener('resize', update);
            releasePosition = () => {
                global.removeEventListener('scroll', update, true);
                global.removeEventListener('resize', update);
                viewport?.removeEventListener('scroll', update);
                viewport?.removeEventListener('resize', update);
                releasePosition = undefined;
            };
            positionListbox();
        }

        function sync() {
            const selectedOption = select.options[select.selectedIndex] || select.options[0];
            value.textContent = selectedOption?.textContent.trim() || '';
            button.setAttribute('aria-label', select.getAttribute('aria-label') || select.name || 'Choose an option');
            const labelledBy = select.getAttribute('aria-labelledby')
                || (!select.getAttribute('aria-label') ? labelIds : '');
            if (labelledBy) button.setAttribute('aria-labelledby', labelledBy);
            else button.removeAttribute('aria-labelledby');
            for (const attribute of ['aria-describedby', 'aria-invalid']) {
                const attributeValue = select.getAttribute(attribute);
                if (attributeValue !== null) button.setAttribute(attribute, attributeValue);
                else button.removeAttribute(attribute);
            }
            button.setAttribute('aria-required', String(select.required));
            button.disabled = select.disabled;
            root.classList.toggle('is-disabled', select.disabled);
            activeIndex = Math.max(select.selectedIndex, 0);

            Array.from(listbox.children).forEach((optionElement, index) => {
                const selected = index === select.selectedIndex;
                optionElement.setAttribute('aria-selected', String(selected));
                optionElement.classList.toggle('is-selected', selected);
            });
            if (select.disabled) close();
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
            if (isOpen()) {
                positionListbox();
                if (isOpen()) setActiveOption(activeIndex);
            }
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
            if (activeOption) {
                const top = activeOption.offsetTop;
                const bottom = top + activeOption.offsetHeight;
                if (top < listbox.scrollTop) listbox.scrollTop = top;
                else if (bottom > listbox.scrollTop + listbox.clientHeight) {
                    listbox.scrollTop = bottom - listbox.clientHeight;
                }
            }

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
            bindPosition();
            if (isOpen()) setActiveOption(activeIndex);
        }

        function close() {
            if (!isOpen()) return;
            releasePosition?.();
            clearPosition();
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
                if (!isOpen()) return;
                if (event.key === 'Home') setActiveOption(0);
                else if (event.key === 'End') setActiveOption(lastIndex);
                else setActiveOption(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
            }
        });

        select.addEventListener('change', sync);
        // Labels and form validation can still focus/click the native field.
        // Keep their target usable without opening an invisible native picker.
        select.addEventListener('focus', () => button.focus());
        select.addEventListener('click', (event) => {
            event.preventDefault();
            button.focus();
        });
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
            attributeFilter: ['disabled', 'required', 'name', 'data-artsoul-value',
                'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-invalid'],
            childList: true,
            subtree: true
        });

        renderOptions();
        enhancedSelects.set(select, { root, sync, observer });
        // The native field remains enabled for form submission and events, but
        // only the ready custom combobox participates in focus/accessibility.
        if (document.activeElement === select) button.focus();
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');
        select.classList.add('artsoul-themed-select__native');
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
