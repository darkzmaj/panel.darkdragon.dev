import styled, { css } from 'styled-components/macro';
import tw from 'twin.macro';

interface Props {
    hideDropdownArrow?: boolean;
}

const Select = styled.select<Props>`
    ${tw`shadow-none block pr-8 w-full text-sm`};
    padding: 0 12px;
    min-height: var(--gb-control-h);
    border: 1px solid var(--gb-border);
    border-radius: var(--gb-radius-md);
    transition: border-color var(--gb-duration) var(--gb-ease), box-shadow var(--gb-duration) var(--gb-ease);

    &,
    &:hover:not(:disabled),
    &:focus {
        ${tw`outline-none`};
    }

    &:focus {
        border-color: var(--gb-primary);
        box-shadow: 0 0 0 3px rgb(var(--p-500) / 0.18);
    }

    -webkit-appearance: none;
    -moz-appearance: none;
    background-size: 1rem;
    background-repeat: no-repeat;
    background-position-x: calc(100% - 0.75rem);
    background-position-y: center;

    &::-ms-expand {
        display: none;
    }

    ${(props) =>
        !props.hideDropdownArrow &&
        css`
            background-color: var(--gb-bg);
            color: var(--gb-text-strong);
            background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3e%3cpath fill='%2394a3ba' d='M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z'/%3e%3c/svg%3e ");

            &:hover:not(:disabled) {
                border-color: rgb(var(--n-500));
            }
        `};

    & option {
        background: var(--gb-surface);
        color: var(--gb-text-strong);
    }
`;

export default Select;
