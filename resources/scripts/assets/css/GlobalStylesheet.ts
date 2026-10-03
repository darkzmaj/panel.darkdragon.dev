import tw from 'twin.macro';
import { createGlobalStyle } from 'styled-components/macro';

// Fonts, colours, scrollbars and focus rings come from /themes/gobia/gobia.css (the design system shared with the
// admin area). Only element defaults that depend on the React tree live here.
export default createGlobalStyle`
    body {
        ${tw`font-sans`};
        background: var(--gb-bg);
        color: var(--gb-text);
        -webkit-font-smoothing: antialiased;
    }

    h1, h2, h3, h4, h5, h6 {
        ${tw`font-medium tracking-normal font-header`};
        color: var(--gb-text-strong);
    }

    p {
        ${tw`leading-snug font-sans`};
        color: inherit;
    }

    a {
        color: inherit;
    }

    form {
        ${tw`m-0`};
    }

    textarea, select, input, button, button:focus, button:focus-visible {
        ${tw`outline-none`};
    }

    input[type=number]::-webkit-outer-spin-button,
    input[type=number]::-webkit-inner-spin-button {
        -webkit-appearance: none !important;
        margin: 0;
    }

    input[type=number] {
        -moz-appearance: textfield !important;
    }
`;
