import styled from 'styled-components/macro';

// Pages are laid out by the application shell; this only keeps content from growing without bound on huge screens.
const ContentContainer = styled.div`
    max-width: var(--gb-container);
`;
ContentContainer.displayName = 'ContentContainer';

export default ContentContainer;
