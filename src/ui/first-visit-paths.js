// The selectors belong to public controls. Reading a step never invokes the control.
const profileAccess = [
    { selector: '.profile-inline-edit-action button', text: 'Choose Edit Profile to open your name, bio and save controls.' },
    { selector: '[data-profile-connect]', text: 'Choose Connect Wallet when you want to create your profile. Then use Edit Profile to enter your name and bio, and Save Profile to keep them.' }
];

export const visitPaths = {
    browse: {
        label: 'Browse artworks',
        steps: [
            { route: '/gallery#all', slot: 'gallery-filter', selector: '.gallery-search-input', title: 'Find a work',
                text: 'Choose a gallery category or type in the filter to narrow the works on this page. You can browse without a wallet.' },
            { route: '/gallery#all', slot: 'gallery-results', selector: '.gallery-results-grid a.artsoul-card-link', title: 'Open an artwork',
                text: 'Select an artwork to see its creator, description and activity.',
                unavailable: 'When a work appears, select it to open its page. You can also clear the filter or choose All works.' },
            { route: '/artwork', slot: 'community', selector: 'button[aria-label="About community reactions"]', title: 'Read about reactions',
                text: 'Open the help beside Community to see what Like, Would Buy and Watching mean before you react.' }
        ]
    },
    profile: {
        label: 'Create a profile',
        steps: [
            { route: '/profile', slot: 'profile-name', selector: '#profileName', alternatives: profileAccess, title: 'Choose your public name',
                text: 'Enter the name collectors should see. Add a bio to introduce yourself and your work.' },
            { route: '/profile', slot: 'profile-save', selector: '.profile-edit-dialog .profile-actions .btn-main', alternatives: profileAccess, title: 'Save your profile',
                text: 'Review your name and bio, then choose Save Profile when you are ready to save your changes.' }
        ]
    },
    artwork: {
        label: 'Publish one artwork',
        steps: [
            { route: '/upload', slot: 'file', selector: '.upload-file-picker', title: 'Choose your file',
                text: 'Use Choose file to select an image, video or audio work. The picker lists the supported formats and size limit.' },
            { route: '/upload', slot: 'details', selector: '#artTitle', title: 'Describe the artwork',
                text: 'Give the work a title and description. Set a starting price and choose an auction duration.' },
            { route: '/upload', slot: 'original', selector: '#originalWorkConfirm', title: 'Confirm authorship',
                text: 'Read Before you publish. Check the box if this is your own original work.' },
            { route: '/upload', slot: 'analysis', selector: '#prePublishAction', title: 'Review value guidance',
                text: 'Once the form is complete, use the authorization button under AI Value Guidance. Review the wallet request and read the guidance before publishing.',
                alternatives: [{ selector: '#aiValuationRetry', slot: 'analysis', text: 'Read the analysis status. Use Retry if you want to request guidance again.' }],
                unavailable: 'Read the current analysis status on the form before continuing.' },
            { route: '/upload', slot: 'publish', selector: '#publishBtn', title: 'Review publication',
                text: 'Check the auction terms and readiness message. Choose Publish Artwork only when you are ready to review the wallet transaction. The NFT is minted after successful settlement.' }
        ]
    },
    collection: {
        label: 'Design a collection',
        steps: [
            { route: '/upload', slot: 'publication-type', selector: '.publication-type-nav a[href="/collection-builder"]', title: 'Open the collection builder',
                text: 'Under Publication type, choose Collection to design a draft in this browser.' },
            { route: '/collection-builder', slot: 'collection-name', selector: '#collectionName', title: 'Describe your collection',
                text: 'Name your collection, describe the work and set a proposed maximum supply.',
                alternatives: [{ selector: '.launch-steps button:first-child', slot: 'collection-steps', text: 'Choose Collection to return to the name, description and supply fields.' }] },
            { route: '/collection-builder', slot: 'collection-steps', selector: '[data-draft-step="Phases"]', title: 'Design the phases',
                text: 'Choose Phases to set the allocation and eligibility for each part of your proposed launch.' },
            { route: '/collection-builder', slot: 'collection-steps', selector: '[data-draft-step="Review"]', title: 'Review the configuration',
                text: 'Choose Review to see the phase table and any configuration items that need attention.' },
            { route: '/collection-builder', selector: '[data-save-collection-draft]', title: 'Keep a local draft',
                text: 'Choose Save draft to keep these settings in this browser. The collection stays unpublished. Saving does not deploy a contract or mint an NFT.' }
        ]
    }
};
