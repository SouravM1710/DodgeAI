const fs = require('fs');
const path = require('path');

function walk(dir: string): string[] {
    let files: string[] = [];

    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);

        if (fs.statSync(full).isDirectory()) {
            files = files.concat(walk(full));
        } else if (f.endsWith('.jsonl') || f.endsWith('.csv')) {
            files.push(full);
        }
    }

    return files;
}

const files = walk('data/raw');

for (const f of files) {
    console.log('\n=== ' + f + ' ===');

    const lines = fs.readFileSync(f, 'utf8')
        .split('\n')
        .filter((l: string) => l.trim());

    console.log('Total lines: ' + lines.length);

    if (lines.length > 0) {
        try {
            const obj = JSON.parse(lines[0]);
            console.log('Fields: ' + Object.keys(obj).join(', '));
            console.log('Sample:', JSON.stringify(obj, null, 2));
        } catch (e) {

            console.log('Line 1: ' + lines[0]);
            if (lines[1]) console.log('Line 2: ' + lines[1]);
        }
    }
}