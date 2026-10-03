import React from 'react';
import styled, { css } from 'styled-components/macro';
import tw from 'twin.macro';
import Spinner from '@/components/elements/Spinner';

interface Props {
    isLoading?: boolean;
    size?: 'xsmall' | 'small' | 'large' | 'xlarge';
    color?: 'green' | 'red' | 'primary' | 'grey';
    isSecondary?: boolean;
}

// One button family: solid blue (primary), surface with border (secondary / grey), red for destructive actions.
const solid = (rgb: string) => css`
    background: ${rgb};
    border-color: transparent;
    color: var(--gb-primary-fg);

    &:hover:not(:disabled) {
        filter: brightness(1.08);
    }
`;

const ButtonStyle = styled.button<Omit<Props, 'isLoading'>>`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    gap: 8px;
    border: 1px solid var(--gb-border);
    border-radius: var(--gb-radius-md);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.1;
    white-space: nowrap;
    cursor: pointer;
    text-decoration: none;
    transition: background var(--gb-duration) var(--gb-ease), border-color var(--gb-duration) var(--gb-ease),
        filter var(--gb-duration) var(--gb-ease);

    ${(props) => (!props.size || props.size === 'small') && tw`h-10 px-4`};
    ${(props) => props.size === 'xsmall' && tw`h-8 px-3 text-xs`};
    ${(props) => props.size === 'large' && tw`h-12 px-6`};
    ${(props) => props.size === 'xlarge' && tw`h-12 px-6 w-full`};

    /* Default (no colour): the blue primary button. */
    ${(props) => ((!props.isSecondary && !props.color) || props.color === 'primary') && solid('var(--gb-primary)')};
    ${(props) => props.color === 'green' && solid('rgb(var(--gb-success))')};
    ${(props) => props.color === 'red' && solid('rgb(var(--gb-danger))')};
    ${(props) =>
        props.color === 'grey' &&
        css`
            background: var(--gb-surface-2);
            border-color: var(--gb-border);
            color: var(--gb-text-strong);

            &:hover:not(:disabled) {
                background: rgb(var(--n-600));
            }
        `};

    /* Secondary: a surface with a border. Coloured secondary buttons fill on hover. */
    ${(props) =>
        props.isSecondary &&
        css<Props>`
            background: var(--gb-surface);
            border-color: var(--gb-border);
            color: var(--gb-text-strong);

            &:hover:not(:disabled) {
                background: ${(p) =>
                    p.color === 'red'
                        ? 'rgb(var(--gb-danger))'
                        : p.color === 'green'
                        ? 'rgb(var(--gb-success))'
                        : p.color === 'primary'
                        ? 'var(--gb-primary)'
                        : 'var(--gb-surface-2)'};
                border-color: ${(p) => (p.color ? 'transparent' : 'var(--gb-border)')};
                color: ${(p) => (p.color ? 'var(--gb-primary-fg)' : 'var(--gb-text-strong)')};
            }
        `};

    &:disabled {
        opacity: 0.55;
        cursor: default;
    }
`;

type ComponentProps = Omit<JSX.IntrinsicElements['button'], 'ref' | keyof Props> & Props;

const Button: React.FC<ComponentProps> = ({ children, isLoading, ...props }) => (
    <ButtonStyle {...props}>
        {isLoading && (
            <div css={tw`flex absolute justify-center items-center w-full h-full left-0 top-0`}>
                <Spinner size={'small'} />
            </div>
        )}
        <span css={isLoading ? tw`text-transparent` : undefined}>{children}</span>
    </ButtonStyle>
);

type LinkProps = Omit<JSX.IntrinsicElements['a'], 'ref' | keyof Props> & Props;

const LinkButton: React.FC<LinkProps> = (props) => <ButtonStyle as={'a'} {...props} />;

export { LinkButton, ButtonStyle };
export default Button;
