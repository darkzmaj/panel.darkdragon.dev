import styled, { css } from 'styled-components/macro';
import tw from 'twin.macro';

export interface Props {
    isLight?: boolean;
    hasError?: boolean;
}

const checkboxStyle = css<Props>`
    ${tw`cursor-pointer appearance-none inline-block align-middle select-none flex-shrink-0 w-4 h-4 border rounded-sm`};
    background-color: var(--gb-bg);
    border-color: var(--gb-border);
    color: var(--gb-primary);
    color-adjust: exact;
    background-origin: border-box;
    transition: all 75ms linear, box-shadow 25ms linear;

    &:checked {
        border-color: transparent;
        ${tw`bg-no-repeat bg-center`};
        background-image: url("data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M5.707 7.293a1 1 0 0 0-1.414 1.414l2 2a1 1 0 0 0 1.414 0l4-4a1 1 0 0 0-1.414-1.414L7 8.586 5.707 7.293z'/%3e%3c/svg%3e");
        background-color: currentColor;
        background-size: 100% 100%;
    }

    &:focus {
        outline: none;
        box-shadow: 0 0 0 3px rgb(var(--p-500) / 0.25);
    }
`;

const inputStyle = css<Props>`
    // Reset to normal styling.
    resize: none;
    ${tw`appearance-none outline-none w-full min-w-0 text-sm`};
    padding: 0 12px;
    min-height: var(--gb-control-h);
    border: 1px solid var(--gb-border);
    border-radius: var(--gb-radius-md);
    background: var(--gb-bg);
    color: var(--gb-text-strong);
    box-shadow: none;
    transition: border-color var(--gb-duration) var(--gb-ease), box-shadow var(--gb-duration) var(--gb-ease);

    &::placeholder {
        color: var(--gb-text-3);
    }

    &:hover:not(:disabled):not(:focus) {
        border-color: rgb(var(--n-500));
    }

    & + .input-help {
        ${tw`mt-1 text-xs`};
        color: ${(props) => (props.hasError ? 'rgb(var(--gb-danger))' : 'var(--gb-text-2)')};
    }

    &:required,
    &:invalid {
        ${tw`shadow-none`};
    }

    &:not(:disabled):not(:read-only):focus {
        border-color: var(--gb-primary);
        box-shadow: 0 0 0 3px rgb(var(--p-500) / 0.18);
        ${(props) =>
            props.hasError &&
            `border-color: rgb(var(--gb-danger)); box-shadow: 0 0 0 3px rgb(var(--gb-danger) / 0.18);`};
    }

    &:disabled {
        opacity: 0.6;
    }

    ${(props) => props.hasError && `border-color: rgb(var(--gb-danger));`};
`;

const Input = styled.input<Props>`
    &:not([type='checkbox']):not([type='radio']) {
        ${inputStyle};
    }

    &[type='checkbox'],
    &[type='radio'] {
        ${checkboxStyle};

        &[type='radio'] {
            ${tw`rounded-full`};
        }
    }
`;
const Textarea = styled.textarea<Props>`
    ${inputStyle};
    padding: 10px 12px;
`;

export { Textarea };
export default Input;
