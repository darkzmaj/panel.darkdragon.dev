import React from 'react';

// The single place the visible copyright line is defined for the React app.
const Copyright = ({ className }: { className?: string }) => (
    <p className={className}>
        &copy; {new Date().getFullYear()} <strong>Gobia Cloud</strong>. All Rights Reserved.
    </p>
);

export default Copyright;
