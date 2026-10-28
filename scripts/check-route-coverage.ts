import { assertRouteCoverage } from '../src/lib/rbac-coverage';

assertRouteCoverage();
process.stdout.write('API route permission and rate-limit coverage: passed\n');
