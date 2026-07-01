// The entry sits after the protocol markup, so controls can initialize without
// waiting for the separately deferred wallet module.
        (function initializeProtocolSections() {
            const sections = document.querySelectorAll('.doc-section');

            sections.forEach((section, index) => {
                // Skip first section (title)
                if (index === 0) return;

                const heading = section.querySelector('h2, h3');
                if (!heading) return;

                // Wrap content after heading
                const content = document.createElement('div');
                content.className = 'content';

                let sibling = heading.nextElementSibling;
                while (sibling) {
                    const next = sibling.nextElementSibling;
                    content.appendChild(sibling);
                    sibling = next;
                }

                section.appendChild(content);

                // Add toggle icon
                const icon = document.createElement('span');
                icon.className = 'toggle-icon';
                icon.textContent = '▾';
                heading.appendChild(icon);

                section.addEventListener('click', function() {
                    section.classList.toggle('open');
                });
            });
        })();
