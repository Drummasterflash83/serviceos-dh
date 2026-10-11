"""Verify working-time collection in the disposable local synthetic database."""
import runpy
import sys
from pathlib import Path
sys.argv.extend(['--include-delays', '--include-working-time', '--include-working-collection'])
runpy.run_path(str(Path(__file__).with_name('learn-work-calendars.py')), run_name='__main__')
