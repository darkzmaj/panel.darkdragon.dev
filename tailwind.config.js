const colors = require('tailwindcss/colors');

// Every neutral / brand colour is a CSS variable defined in public/themes/gobia/gobia.css, one set for light and one
// for dark. Components keep using classes like `bg-neutral-800` and `text-neutral-200`; what they mean (card surface,
// secondary text, ...) is decided per theme by the tokens, so no component needs to know which theme is active.
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
const ramp = (channel) =>
    Object.fromEntries(STEPS.map((step) => [step, `rgb(var(--${channel}-${step}) / <alpha-value>)`]));

const neutral = ramp('n');
const brand = ramp('p');

module.exports = {
    content: [
        './resources/scripts/**/*.{js,ts,tsx}',
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Manrope"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
                header: ['"Space Grotesk"', '"Manrope"', 'system-ui', 'sans-serif'],
            },
            colors: {
                black: 'rgb(var(--n-black) / <alpha-value>)',
                // "primary" and "neutral" are deprecated, prefer the use of "blue" and "gray" in new code.
                primary: brand,
                gray: neutral,
                neutral,
                // The interface accent used to be cyan; it is the Gobia blue now.
                cyan: brand,
                blue: brand,
                // Status colours keep their hue but follow the theme for contrast.
                red: colors.red,
            },
            borderRadius: {
                gb: 'var(--gb-radius-md)',
                'gb-lg': 'var(--gb-radius-lg)',
            },
            fontSize: {
                '2xs': '0.625rem',
            },
            transitionDuration: {
                250: '250ms',
            },
            borderColor: () => ({
                default: 'var(--gb-border)',
            }),
        },
    },
    plugins: [
        require('@tailwindcss/line-clamp'),
        require('@tailwindcss/forms')({
            strategy: 'class',
        }),
    ]
};
