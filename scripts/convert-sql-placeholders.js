import fs from 'fs';

const filePath = 'src/indexer/sync-engine.js';
let content = fs.readFileSync(filePath, 'utf8');

// Find all SQL queries with ? placeholders
const sqlPattern = /(`[^`]*\?[^`]*`)/g;
const matches = content.match(sqlPattern);

if (matches) {
    matches.forEach(match => {
        let questionMarkCount = (match.match(/\?/g) || []).length;
        let newMatch = match;

        // Replace ? with $1, $2, $3, etc.
        for (let i = 1; i <= questionMarkCount; i++) {
            newMatch = newMatch.replace('?', `$${i}`);
        }

        content = content.replace(match, newMatch);
    });
}

// Also replace ON DUPLICATE KEY UPDATE (MySQL) with ON CONFLICT (PostgreSQL)
content = content.replace(/ON DUPLICATE KEY UPDATE/g, 'ON CONFLICT DO NOTHING');

fs.writeFileSync(filePath, content, 'utf8');
console.log(' Converted all ? placeholders to PostgreSQL $1, $2, $3 format');
console.log(' Replaced ON DUPLICATE KEY UPDATE with ON CONFLICT');
