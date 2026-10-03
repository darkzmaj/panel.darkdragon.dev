import styled from 'styled-components/macro';
import tw from 'twin.macro';

// A bordered row on a surface, for lists of records (backups, API keys, SSH keys...).
export default styled.div<{ $hoverable?: boolean }>`
    ${tw`flex no-underline items-center p-4 overflow-hidden`};
    color: var(--gb-text);
    background: var(--gb-surface);
    border: 1px solid var(--gb-border-muted);
    border-radius: var(--gb-radius-lg);
    transition: border-color var(--gb-duration) var(--gb-ease), background var(--gb-duration) var(--gb-ease);

    ${(props) => props.$hoverable !== false && `&:hover { border-color: rgb(var(--n-500)); }`};

    & .icon {
        ${tw`flex items-center justify-center flex-none`};
        width: 40px;
        height: 40px;
        border-radius: 10px;
        border: 1px solid var(--gb-border-muted);
        background: var(--gb-bg);
        color: var(--gb-primary);
    }
`;
