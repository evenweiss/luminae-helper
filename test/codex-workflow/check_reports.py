"""Read a normalized checkpoint snapshot and return an unsent report."""
import json

def audit(checkpoint, coordinator, executor, artifact=None):
    task = (checkpoint['task'], checkpoint['version'])
    def matches(record):
        return (record.get('task'), record.get('version')) == task
    if not all(map(matches, (coordinator, executor))):
        return {'status': 'stale_or_unverified', 'notification': 'none'}
    if checkpoint['closed'] or not checkpoint['due']:
        return {'status': 'no_check_due', 'notification': 'none'}
    evidence = bool(artifact and artifact.is_file()
                    and matches(json.loads(artifact.read_text()))
                    and executor.get('status') == 'completed')
    if not evidence:
        evidence_status = 'unverified'
    else:
        evidence_status = 'candidate_available'
    coordinator_missed = coordinator.get('userNotice') == 'not_sent'
    outcome = {
        'task': task[0], 'version': task[1], 'status': evidence_status,
        'executorDelivered': executor.get('outboundReceipt') == 'delivered',
        'coordinatorCollected': coordinator.get('collection') == 'collected',
        'coordinatorMissedNotice': coordinator_missed,
        'independentAcceptance': coordinator.get('acceptance', 'unknown'),
        'notification': 'none',
    }
    if evidence:
        outcome['evidence'] = str(artifact)
    if coordinator_missed:
        outcome['notification'] = 'draft_for_authorized_user_route' if checkpoint['userNotificationApproved'] else 'awaiting_authorization'
        outcome['nextOwner'] = checkpoint['coordinator']
    return outcome
