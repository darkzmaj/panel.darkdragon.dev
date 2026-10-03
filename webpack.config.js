const path = require('node:path');
const webpack = require('webpack');
const { WebpackAssetsManifest } = require('webpack-assets-manifest');
const TerserPlugin = require('terser-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
    cache: true,
    target: 'web',
    mode: isProduction ? 'production' : 'development',
    devtool: process.env.DEVTOOL || (isProduction ? false : 'eval-source-map'),
    performance: {
        hints: false,
    },
    entry: {
        main: isProduction ? ['./resources/scripts/index.tsx'] : ['react-hot-loader/patch', './resources/scripts/index.tsx'],
        // Small separate entry for the admin template file editor, loaded only on that page.
        'template-editor': './resources/scripts/templateEditor.tsx',
    },
    output: {
        path: path.join(__dirname, '/public/assets'),
        filename: (pathData) => {
            const prefix = pathData.chunk && pathData.chunk.name === 'main' ? 'bundle' : '[name]';

            return isProduction ? prefix + '.[chunkhash:8].js' : prefix + '.[fullhash:8].js';
        },
        chunkFilename: isProduction ? '[name].[chunkhash:8].js' : '[name].[fullhash:8].js',
        publicPath: process.env.WEBPACK_PUBLIC_PATH || '/assets/',
        crossOriginLoading: 'anonymous',
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules|\.spec\.tsx?$/,
                loader: 'babel-loader',
            },
            {
                test: /\.mjs$/,
                include: /node_modules/,
                type: 'javascript/auto',
            },
            {
                // Monaco ships plain stylesheets; they don't need Tailwind or CSS modules.
                test: /\.css$/,
                include: /node_modules[\\/]monaco-editor/,
                use: ['style-loader', 'css-loader'],
            },
            {
                test: /\.css$/,
                exclude: /node_modules[\\/]monaco-editor/,
                use: [
                    { loader: 'style-loader' },
                    {
                        loader: 'css-loader',
                        options: {
                            modules: {
                                auto: true,
                                // https://github.com/webpack/css-loader/blob/main/CHANGELOG.md#700-2024-04-04
                                namedExport: false,
                                exportLocalsConvention: 'as-is',
                                localIdentName: isProduction ? '[name]_[hash:base64:8]' : '[path][name]__[local]',
                                localIdentContext: path.join(__dirname, 'resources/scripts/components'),
                            },
                            sourceMap: !isProduction,
                            importLoaders: 1,
                        },
                    },
                    {
                        loader: 'postcss-loader',
                        options: { sourceMap: !isProduction },
                    },
                ],
            },
            {
                test: /\.(png|jp(e?)g|gif)$/,
                loader: 'file-loader',
                options: {
                    name: 'images/[name].[hash:8].[ext]',
                },
            },
            {
                test: /\.(woff|woff2|ttf)$/i,
                type: 'asset/resource',
            },
            {
                test: /\.svg$/,
                loader: 'svg-url-loader',
            },
            {
                test: /\.js$/,
                exclude: /node_modules[\\/]monaco-editor/,
                enforce: 'pre',
                loader: 'source-map-loader',
            },
        ],
    },
    stats: {
        // Ignore warnings emitted by "source-map-loader" when trying to parse source maps from
        // JS plugins we use, namely brace editor.
        warningsFilter: [/Failed to parse source map/],
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js', '.json'],
        alias: {
            '@': path.join(__dirname, '/resources/scripts'),
            '@definitions': path.join(__dirname, '/resources/scripts/api/definitions'),
            '@feature': path.join(__dirname, '/resources/scripts/components/server/features'),
        },
        symlinks: false,
    },
    externals: {
        // Mark moment as an external to exclude it from the Chart.js build since we don't need to use
        // it for anything.
        moment: 'moment',
    },
    plugins: [
        // Monaco is only loaded when a file is opened in the editor (see MonacoEditor.tsx). The plugin emits its
        // web workers as separate files and wires them up, restricted to the languages the editor offers.
        new MonacoWebpackPlugin({
            filename: isProduction ? 'monaco-[name].worker.[contenthash:8].js' : 'monaco-[name].worker.js',
            languages: [
                'css',
                'dockerfile',
                'html',
                'ini',
                'java',
                'javascript',
                'json',
                'markdown',
                'php',
                'python',
                'shell',
                'typescript',
                'xml',
                'yaml',
            ],
        }),
        new webpack.EnvironmentPlugin({
            NODE_ENV: process.env.NODE_ENV || 'development',
            DEBUG: process.env.NODE_ENV !== 'production',
            WEBPACK_BUILD_HASH: Date.now().toString(16),
        }),
        new WebpackAssetsManifest({
            output: 'manifest.json',
            writeToDisk: true,
            publicPath: true,
            integrity: true,
            integrityHashes: ['sha384'],
        }),
    ],
    optimization: {
        usedExports: true,
        // Honour the "sideEffects" flag of packages so unused re-exports in barrel files (icons, date-fns) can be dropped.
        sideEffects: true,
        runtimeChunk: false,
        // Don't split off tiny shared modules into their own files; each one costs a request on a cold load.
        splitChunks: {
            chunks: 'async',
            minSize: 60000,
        },
        removeEmptyChunks: true,
        minimize: isProduction,
        minimizer: [
            new TerserPlugin({
                parallel: true,
                extractComments: false,
                terserOptions: {
                    mangle: true,
                    output: {
                        comments: false,
                    },
                },
            }),
        ],
    },
    watchOptions: {
        poll: 1000,
        ignored: /node_modules/,
    },
    devServer: {
        compress: true,
        port: 5173,
        server: {
            type: 'https',
            options: process.env.USE_LOCAL_CERTS
                ? {
                      ca: path.join(__dirname, '../../docker/certificates/root_ca.pem'),
                      cert: path.join(__dirname, '../../docker/certificates/pterodactyl.test.pem'),
                      key: path.join(__dirname, '../../docker/certificates/pterodactyl.test-key.pem'),
                  }
                : undefined,
        },
        static: {
            directory: path.join(__dirname, '/public'),
            publicPath: process.env.WEBPACK_PUBLIC_PATH || '/assets/',
        },
        allowedHosts: ['.pterodactyl.test'],
        headers: {
            'Access-Control-Allow-Origin': '*',
        },
    },
};
