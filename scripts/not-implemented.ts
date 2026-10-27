const message = process.argv[2] ?? 'This command is not implemented in the current phase.';
process.stderr.write(`${message}\n`);
process.exit(1);
