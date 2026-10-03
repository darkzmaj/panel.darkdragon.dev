import React from 'react';
import { Route } from 'react-router';
import Fade from '@/components/elements/Fade';

// A short fade-in for the new page. The old page is replaced immediately: waiting for it to fade out first used to add
// a delay to every single navigation.
const TransitionRouter: React.FC = ({ children }) => {
    return (
        <Route
            render={({ location }) => (
                <Fade timeout={100} key={location.pathname + location.search} in appear>
                    <section>{children}</section>
                </Fade>
            )}
        />
    );
};

export default TransitionRouter;
