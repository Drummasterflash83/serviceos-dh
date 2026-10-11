"""Run isolated schema-only working-time verification. No hosted/provider access."""
import runpy
import sys
from pathlib import Path
sys.argv.extend(['--include-delays', '--include-working-time'])
runpy.run_path(str(Path(__file__).with_name('learn-work-calendars.py')), run_name='__main__')
