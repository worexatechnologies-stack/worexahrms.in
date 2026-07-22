import pkg from 'mongodb';
const { MongoClient, BSON } = pkg;
const { EJSON } = BSON;
import fs from 'fs';
import path from 'path';
import dns from 'dns';

// Force DNS resolution to prioritize IPv4, fixing Windows IPv6 DNS SRV issues in Node.js
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name) => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  if (arg) return arg.split('=')[1];
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return null;
};

const inputUri = getArg('uri');
const inDir = getArg('dir') || './prod-backup';

if (!inputUri) {
  console.error('Error: Please provide a target MongoDB connection URI via --uri.');
  console.error('Usage example:');
  console.error('  node db-restore.js --uri="mongodb://127.0.0.1:27017/hrms" --dir="./prod-backup"');
  process.exit(1);
}

// Extract database name from connection string
let dbName = 'hrms';
try {
  const parsedUri = new URL(inputUri);
  const pathName = parsedUri.pathname.replace(/^\//, '');
  if (pathName) {
    dbName = pathName;
  }
} catch (e) {
  // srv connection strings may fail simple URL parsing in some versions of Node; fallback to default
}

async function resolveSrvUri(uri) {
  if (!uri.startsWith('mongodb+srv://')) {
    return uri;
  }
  
  try {
    console.log('Detected mongodb+srv URI. Resolving SRV records via Cloudflare DNS over HTTPS to bypass local DNS bugs...');
    
    // Parse the URI components
    // Format: mongodb+srv://[username:password@]host/[database][?options]
    const match = uri.match(/^mongodb\+srv:\/\/([^@]+@)?([^\/\?]+)([^?]*)(.*)$/);
    if (!match) {
      console.log('Failed to parse mongodb+srv URI structure, using original URI.');
      return uri;
    }
    
    const userPass = match[1] || ''; // includes '@' at the end
    const host = match[2];
    const dbAndPath = match[3] || '/';
    const queryParams = match[4] || '';
    
    // Query DNS over HTTPS
    const dohUrl = `https://cloudflare-dns.com/dns-query?name=_mongodb._tcp.${host}&type=SRV`;
    const response = await fetch(dohUrl, { headers: { 'accept': 'application/dns-json' } });
    if (!response.ok) {
      throw new Error(`DOH request failed with status ${response.status}`);
    }
    
    const result = await response.json();
    if (!result.Answer || result.Answer.length === 0) {
      throw new Error('No SRV records returned by DOH.');
    }
    
    // Extract svr hostname from answer data
    const resolvedHosts = result.Answer
      .filter(ans => ans.type === 33) // Type 33 is SRV
      .map(ans => {
        const parts = ans.data.split(/\s+/);
        const port = parts[2];
        const target = parts[3].replace(/\.$/, ''); // remove trailing dot if present
        return `${target}:${port}`;
      });
    
    if (resolvedHosts.length === 0) {
      throw new Error('No hosts resolved from SRV records.');
    }
    
    // Construct standard mongodb:// connection string
    // Standard connection requires tls=true by default for atlas replica set
    let options = queryParams;
    if (options) {
      if (!options.includes('tls=') && !options.includes('ssl=')) {
        options += '&tls=true';
      }
    } else {
      options = '?tls=true';
    }
    
    const newUri = `mongodb://${userPass}${resolvedHosts.join(',')}${dbAndPath}${options}`;
    console.log(`Successfully resolved to: mongodb://${userPass ? '****@' : ''}${resolvedHosts.join(',')}${dbAndPath}${options}`);
    return newUri;
  } catch (error) {
    console.warn(`Warning: Failed to resolve SRV records via DoH (${error.message}). Falling back to original URI.`);
    return uri;
  }
}

async function run() {
  let client;
  try {
    if (!fs.existsSync(inDir)) {
      console.error(`Error: Source directory ${inDir} does not exist.`);
      return;
    }
    
    const files = fs.readdirSync(inDir).filter(file => file.endsWith('.json'));
    
    if (files.length === 0) {
      console.log('No backup JSON files found in the source directory.');
      return;
    }
    
    const uri = await resolveSrvUri(inputUri);
    
    console.log('----------------------------------------------------');
    console.log('MongoDB Restore Tool');
    console.log('----------------------------------------------------');
    console.log(`Restoring to: ${uri.replace(/:([^@]+)@/, ':****@')}`); // Hide credentials in logs
    console.log(`Database name: ${dbName}`);
    console.log(`Source folder: ${path.resolve(inDir)}`);
    console.log('----------------------------------------------------');

    client = new MongoClient(uri);
    await client.connect();
    console.log('Connection successful!');
    
    const db = client.db(dbName);
    
    for (const file of files) {
      const colName = path.basename(file, '.json');
      const filePath = path.join(inDir, file);
      
      console.log(`Restoring collection: ${colName}...`);
      
      const fileContent = fs.readFileSync(filePath, 'utf8');
      if (!fileContent.trim() || fileContent.trim() === '[]') {
        console.log(`  Collection ${colName} backup is empty, skipping.`);
        continue;
      }
      
      // Parse with EJSON to reconstruct proper MongoDB BSON types (Dates, ObjectIds)
      const documents = EJSON.parse(fileContent);
      
      if (Array.isArray(documents) && documents.length > 0) {
        const collection = db.collection(colName);
        
        // Clear target collection first
        console.log(`  Clearing target collection: ${colName}...`);
        await collection.deleteMany({});
        
        // Insert documents
        console.log(`  Inserting ${documents.length} documents...`);
        const result = await collection.insertMany(documents);
        console.log(`  Successfully restored ${result.insertedCount} documents.`);
      } else {
        console.log(`  No valid documents in ${file}, skipping.`);
      }
    }
    
    console.log('\nRestore completed successfully!');
  } catch (error) {
    console.error('An error occurred during database import:', error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

run();
