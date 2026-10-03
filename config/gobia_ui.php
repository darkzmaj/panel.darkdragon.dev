<?php

/*
|--------------------------------------------------------------------------
| Gobia Cloud interface (footer content)
|--------------------------------------------------------------------------
|
| Content of the footer shown on every page. Link targets are either an absolute URL, a path that is appended to
| GOBIA_SITE_URL, or the name of a Panel route written as "route:name". Set a column's "soon" flag to show the SOON badge
| instead of a link.
*/
return [
    'site_url' => env('GOBIA_SITE_URL', 'https://gobia.cloud'),
    'discord_url' => env('GOBIA_DISCORD_URL'),

    'tagline_strong' => 'Beyond The Clouds',
    'tagline' => ', a secure digital home for your files, projects, and ideas — with reliable storage, easy access, and built-in peace of mind.',

    'footer' => [
        'PRODUCT' => [
            ['label' => 'Cloud', 'href' => '/cloud'],
            ['label' => 'Tools', 'href' => '/tools'],
            ['label' => 'Pricing', 'href' => '/pricing'],
            ['label' => 'Hosting Roadmap', 'href' => '/roadmap'],
        ],
        'COMPANY' => [
            ['label' => 'About Us', 'href' => '/about'],
            ['label' => 'Contact', 'href' => '/contact'],
            ['label' => 'Careers', 'soon' => true],
        ],
        'ACCOUNT' => [
            ['label' => 'Login', 'href' => 'route:auth.login'],
            ['label' => 'Register', 'href' => '/register'],
            ['label' => 'Dashboard', 'href' => 'route:index'],
        ],
        'LEGAL' => [
            ['label' => 'Privacy Policy', 'href' => '/privacy'],
            ['label' => 'Terms of Service', 'href' => '/terms'],
            ['label' => 'Cookie Policy', 'href' => '/cookies'],
            ['label' => 'DMCA', 'href' => '/dmca'],
            ['label' => 'Impressum', 'href' => '/impressum'],
        ],
    ],
];
