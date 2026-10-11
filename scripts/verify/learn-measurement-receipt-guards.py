"""Exercise receipt constraints with real local collectors and correction RPCs."""
import runpy
import sys
from pathlib import Path
sys.argv.extend(['--include-delays','--include-working-time','--include-working-collection','--include-receipt-guards','--include-working-corrections'])
runpy.run_path(str(Path(__file__).with_name('learn-work-calendars.py')),run_name='__main__')
