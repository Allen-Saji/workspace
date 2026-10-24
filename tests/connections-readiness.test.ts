import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedEnabled} from '../src/connections/http.ts';
import {reportedState} from '../src/ui/report-clock.ts';
test('hosted credentials cannot be activated with an environment flag alone',()=>{assert.equal(hostedEnabled({WORKSPACE_CONNECTIONS:'hosted',WORKSPACE_STORAGE:'supabase'}),false);});
test('report freshness never claims that an agent is running',()=>{assert.match(reportedState(null,100000000),/verification/);assert.match(reportedState('1970-01-01T00:00:00Z',100000000),/stale/);assert.match(reportedState('1970-01-02T00:00:00Z',100000000),/unverified/);});
