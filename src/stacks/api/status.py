import logging
from flask import jsonify, current_app
from stacks.utils.logutils import LOG_BUFFER, get_recent_logs

from . import api_bp
from stacks.security.auth import require_auth_with_permissions

logger = logging.getLogger("api")


def _fast_download_usage(ops):
    """Local daily fast download counter (limit configured in Stacks)."""
    config = current_app.stacks_config
    if not (config.get('fast_download', 'enabled', default=False)
            and config.get('fast_download', 'key')):
        return {'available': False, 'downloads_left': None, 'downloads_per_day': None}
    limit = config.get('fast_download', 'daily_limit', default=50)
    usage = ops.get_fast_download_usage(limit)
    return {
        'available': True,
        'downloads_used': usage['used'],
        'downloads_left': usage['left'],
        'downloads_per_day': usage['limit'] or None,
        'next_slot': usage['next_slot'],
        'full_reset': usage['full_reset'],
        'source': usage['source'],
    }


def get_queue_ops():
    """Get the queue operations instance for multi-process mode."""
    from stacks.coordinator.queue_ops import QueueOperations
    return QueueOperations()


@api_bp.get("/api/health")
def health():
    return {"status": "ok"}


@api_bp.get("/api/version")
def api_version():
    """Get current version and tampermonkey script version"""
    from stacks.constants import VERSION, TAMPER_VERSION

    return jsonify({
        "version": VERSION,
        "tamper_version": TAMPER_VERSION
    })


@api_bp.get("/api/logs")
@require_auth_with_permissions(allow_downloader=False)
def get_logfile():
    """Return recent console logs"""
    return jsonify({"lines": get_recent_logs()})


@api_bp.get("/api/status")
@require_auth_with_permissions(allow_downloader=False)
def api_status():
    """Get current status"""
    if current_app.stacks_multiprocess:
        # Multi-process mode: use queue_ops
        ops = get_queue_ops()
        db_status = ops.get_status()

        # Transform for API compatibility with frontend
        active = db_status.get('active', [])
        queued = db_status.get('queued', [])

        for item in active:
            # Use real progress from DB; fall back to zeros if not yet reported
            if not isinstance(item.get('progress'), dict):
                item['progress'] = {
                    'percent': 0,
                    'downloaded': 0,
                    'total_size': 0,
                    'speed': 0
                }
            # Use filename as display name
            if not item.get('filename'):
                item['filename'] = item.get('title') or item.get('md5', 'Unknown')
            # Add status message from assigned_mirror if available
            if not item.get('status_message') and item.get('assigned_mirror'):
                try:
                    import json
                    mirror = item['assigned_mirror']
                    if isinstance(mirror, str):
                        mirror = json.loads(mirror)
                    item['status_message'] = f"Downloading from {mirror.get('domain', 'mirror')}..."
                except (json.JSONDecodeError, TypeError):
                    item['status_message'] = 'Downloading...'

        # Use first active download as 'current' for backwards compatibility
        current = active[0] if active else None

        # Build response in format frontend expects
        status = {
            'current': current,
            'current_downloads': active,
            'queue': queued,  # Frontend expects 'queue', not 'queued'
            'queue_size': len(queued),
            'recent_history': db_status.get('history', [])[:10],
            'fast_download': _fast_download_usage(ops),
            'paused': db_status.get('paused', False),
            'workers': db_status.get('workers', []),
            'busy_mirrors': db_status.get('busy_mirrors', [])
        }

    else:
        # Debug mode: use old queue/worker
        q = current_app.stacks_queue
        w = current_app.stacks_worker

        status = q.get_status()

        w.refresh_fast_download_info_if_stale()
        status["fast_download"] = w.get_fast_download_info()
        status["paused"] = w.paused

        # Add empty multi-process fields for API consistency
        status['current_downloads'] = [status['current']] if status.get('current') else []
        status['workers'] = []
        status['busy_mirrors'] = []

    return jsonify(status)


# lokal (28.10.): Verlauf der Gesamtgeschwindigkeit (24 h) für den Graphen
@api_bp.get("/api/speed_history")
@require_auth_with_permissions(allow_downloader=False)
def api_speed_history():
    if not current_app.stacks_multiprocess:
        return jsonify({'samples': [], 'completed': [], 'hours': 24})
    return jsonify(get_queue_ops().get_speed_history(24))
