import styled from 'styled-components/macro';

// `isLight` is kept for the older call sites; the theme decides the colour now.
const Label = styled.label<{ isLight?: boolean }>`
    display: block;
    margin-bottom: 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--gb-text-strong);
`;

export default Label;
