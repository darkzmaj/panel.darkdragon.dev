'use strict';
// Path handling for the template SFTP service. Everything a client sends is treated as hostile: a virtual path is
// normalised inside a fixed root, every existing component must be a real file or folder (never a symlink), and the
// final location must still be inside the root. The same name rules as the Panel's TemplateFileStore apply to anything
// that is created or renamed.
const fs = require('node:fs');
const path = require('node:path');

const RESERVED = new Set(['.pterodactyl', '.wings', '.env', '.htaccess', '.htpasswd']);

class JailError extends Error {
    constructor(message, code = 'denied') {
        super(message);
        this.code = code;
    }
}

/** Same rules as TemplateFileStore::normalizePath, applied to one name that is being created. */
const assertValidName = (name) => {
    if (!name || name === '.' || name === '..') throw new JailError('invalid name');
    if (name.length > 255) throw new JailError('name too long');
    if (/[\x00-\x1f\x7f]/.test(name) || name.includes('\\') || name.includes('/')) throw new JailError('invalid characters');
    if (/%[0-9a-f]{2}/i.test(name)) throw new JailError('percent-encoded names are not allowed');
    if (/^\.+$/.test(name) || /[<>:"|?*]/.test(name)) throw new JailError('invalid name');
    if (RESERVED.has(name.toLowerCase())) throw new JailError('reserved name');
};

/** Normalises a client path to "/a/b" form. ".." can never climb above "/". */
const virtual = (p) => path.posix.normalize('/' + String(p || '/').replace(/\\/g, '/')).replace(/\/+$/, '') || '/';

class Jail {
    /** @param {string} root absolute path of the template's working directory */
    constructor(root) {
        this.root = fs.realpathSync(root);
    }

    /** Absolute path for a virtual path. Throws if any existing component is a symlink or the result leaves the root. */
    resolve(p) {
        const v = virtual(p);
        let current = this.root;
        for (const segment of v.split('/').filter(Boolean)) {
            current = path.join(current, segment);
            let stat;
            try {
                stat = fs.lstatSync(current);
            } catch (e) {
                if (e.code === 'ENOENT') continue; // does not exist (yet): later segments cannot be links either
                throw e;
            }
            if (stat.isSymbolicLink()) throw new JailError('symbolic links are not allowed');
        }
        const parent = path.dirname(current);
        if (current !== this.root && fs.existsSync(parent)) {
            const real = fs.realpathSync(parent);
            if (real !== this.root && !real.startsWith(this.root + path.sep)) throw new JailError('outside the template');
        }
        if (current !== this.root && !current.startsWith(this.root + path.sep)) throw new JailError('outside the template');

        return current;
    }

    /** The virtual path of an absolute path inside the root. */
    toVirtual(absolute) {
        const relative = path.relative(this.root, absolute).split(path.sep).join('/');

        return '/' + relative;
    }

    /** Total size and file count of the tree (symlinks ignored). */
    usage() {
        let bytes = 0;
        let files = 0;
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isSymbolicLink()) continue;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (entry.isFile()) {
                    files++;
                    bytes += fs.statSync(full).size;
                }
            }
        };
        walk(this.root);

        return { bytes, files };
    }
}

module.exports = { Jail, JailError, assertValidName, virtual };
