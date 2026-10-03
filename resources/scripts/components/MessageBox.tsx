import * as React from 'react';
import tw from 'twin.macro';
import styled from 'styled-components/macro';

export type FlashMessageType = 'success' | 'info' | 'warning' | 'error';

interface Props {
    title?: string;
    children: string;
    type?: FlashMessageType;
}

// Status colours are channel tokens, so each one stays readable in both themes.
const tone = (type?: FlashMessageType) =>
    type === 'error'
        ? 'var(--gb-danger)'
        : type === 'success'
        ? 'var(--gb-success)'
        : type === 'warning'
        ? 'var(--gb-warning)'
        : 'var(--p-500)';

const Container = styled.div<{ $type?: FlashMessageType }>`
    ${tw`p-3 items-center leading-normal flex w-full text-sm`};
    border: 1px solid rgb(${(props) => tone(props.$type)} / 0.35);
    background: rgb(${(props) => tone(props.$type)} / 0.1);
    border-radius: var(--gb-radius-md);
    color: var(--gb-text-strong);
`;
Container.displayName = 'MessageBox.Container';

const MessageBox = ({ title, children, type }: Props) => (
    <Container css={tw`lg:inline-flex`} $type={type} role={'alert'}>
        {title && (
            <span
                className={'title'}
                css={tw`flex rounded-full uppercase px-2 py-1 text-xs font-bold mr-3 leading-none`}
                style={{ background: `rgb(${tone(type)} / 0.2)`, color: `rgb(${tone(type)})` }}
            >
                {title}
            </span>
        )}
        <span css={tw`mr-2 text-left flex-auto`}>{children}</span>
    </Container>
);
MessageBox.displayName = 'MessageBox';

export default MessageBox;
