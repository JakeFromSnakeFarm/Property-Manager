<?php
header('Content-Type: application/json');

$dataFile = __DIR__ . DIRECTORY_SEPARATOR . 'data.json';
$uploadsDir = __DIR__ . DIRECTORY_SEPARATOR . 'uploads';
if (!file_exists($uploadsDir)) { @mkdir($uploadsDir, 0775, true); }

function read_json($path) {
    if (!file_exists($path)) return [];
    $fp = fopen($path, 'c+');
    if (!$fp) return [];
    flock($fp, LOCK_SH);
    $size = filesize($path);
    $raw = $size > 0 ? fread($fp, $size) : '';
    flock($fp, LOCK_UN);
    fclose($fp);
    $data = json_decode($raw ?: '[]', true);
    return is_array($data) ? $data : [];
}

function write_json($path, $data) {
    $tmp = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    $fp = fopen($path, 'c+');
    if (!$fp) return false;
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    fwrite($fp, $tmp);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    return true;
}

function uuid() {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function get_body_json() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function find_index_by_id($items, $id) {
    foreach ($items as $i => $it) {
        if (isset($it['id']) && $it['id'] === $id) return $i;
    }
    return -1;
}

function sort_items(&$items) {
    $priorityOrder = [ 'urgent' => 0, 'high' => 1, 'normal' => 2, 'low' => 3 ];
    usort($items, function ($a, $b) use ($priorityOrder) {
        $pa = $priorityOrder[$a['priority'] ?? 'normal'] ?? 9;
        $pb = $priorityOrder[$b['priority'] ?? 'normal'] ?? 9;
        if ($pa !== $pb) return $pa <=> $pb;
        $ta = strtotime($a['updated_at'] ?? $a['created_at'] ?? '');
        $tb = strtotime($b['updated_at'] ?? $b['created_at'] ?? '');
        return $tb <=> $ta; // newest first
    });
}

$action = $_GET['action'] ?? 'list';

try {
    switch ($action) {
        case 'list': {
            $items = read_json($dataFile);
            $changed = false;
            foreach ($items as &$it) {
                if (!array_key_exists('labor_time', $it)) { $it['labor_time'] = 0.0; $changed = true; }
                if (!array_key_exists('labor_cost_estimate', $it)) { $it['labor_cost_estimate'] = 0.0; $changed = true; }
                if (!array_key_exists('parts_cost', $it)) { $it['parts_cost'] = 0.0; $changed = true; }
                if (!array_key_exists('asking_for_reimbursement', $it)) { $it['asking_for_reimbursement'] = false; $changed = true; }
                if (!array_key_exists('my_cost', $it)) { $it['my_cost'] = 0.0; $changed = true; }
            }
            unset($it);
            if ($changed) { write_json($dataFile, $items); }
            sort_items($items);
            echo json_encode([ 'ok' => true, 'items' => $items ]);
            break;
        }
        case 'create': {
            $items = read_json($dataFile);
            $body = get_body_json();
            $now = gmdate('c');
            $item = [
                'id' => $body['id'] ?? uuid(),
                'title' => $body['title'] ?? '',
                'description' => $body['description'] ?? '',
                'resolution' => $body['resolution'] ?? '',
                'status' => $body['status'] ?? 'new',
                'priority' => $body['priority'] ?? 'normal',
                'category' => $body['category'] ?? 'misc',
                'room' => $body['room'] ?? '',
                'reported_by' => $body['reported_by'] ?? '',
                'next_action' => $body['next_action'] ?? '',
                'due_by' => $body['due_by'] ?? null,
                'labor_time' => isset($body['labor_time']) ? floatval($body['labor_time']) : 0.0,
                'labor_cost_estimate' => isset($body['labor_cost_estimate']) ? floatval($body['labor_cost_estimate']) : 0.0,
                'parts_cost' => isset($body['parts_cost']) ? floatval($body['parts_cost']) : 0.0,
                'asking_for_reimbursement' => !!($body['asking_for_reimbursement'] ?? false),
                'my_cost' => isset($body['my_cost']) ? floatval($body['my_cost']) : 0.0,
                'created_at' => $now,
                'updated_at' => $now,
                'images' => [],
            ];
            $items[] = $item;
            write_json($dataFile, $items);
            echo json_encode([ 'ok' => true, 'item' => $item ]);
            break;
        }
        case 'update': {
            $items = read_json($dataFile);
            $body = get_body_json();
            $id = $body['id'] ?? null;
            if (!$id) { http_response_code(400); echo json_encode([ 'ok' => false, 'error' => 'Missing id' ]); break; }
            $idx = find_index_by_id($items, $id);
            if ($idx < 0) { http_response_code(404); echo json_encode([ 'ok' => false, 'error' => 'Not found' ]); break; }
            $now = gmdate('c');
            $allowed = [ 'title','description','resolution','status','priority','category','room','reported_by','next_action','due_by','labor_time','labor_cost_estimate','parts_cost','asking_for_reimbursement','my_cost' ];
            foreach ($allowed as $k) {
                if (array_key_exists($k, $body)) {
                    if (in_array($k, ['labor_time','labor_cost_estimate','parts_cost','my_cost'], true)) {
                        $items[$idx][$k] = floatval($body[$k]);
                    } elseif ($k === 'asking_for_reimbursement') {
                        $items[$idx][$k] = !!$body[$k];
                    } else {
                        $items[$idx][$k] = $body[$k];
                    }
                }
            }
            $items[$idx]['updated_at'] = $now;
            write_json($dataFile, $items);
            echo json_encode([ 'ok' => true, 'item' => $items[$idx] ]);
            break;
        }
        case 'delete': {
            $items = read_json($dataFile);
            $body = get_body_json();
            $id = $body['id'] ?? null;
            if (!$id) { http_response_code(400); echo json_encode([ 'ok' => false, 'error' => 'Missing id' ]); break; }
            $idx = find_index_by_id($items, $id);
            if ($idx < 0) { http_response_code(404); echo json_encode([ 'ok' => false, 'error' => 'Not found' ]); break; }
            // Remove images from disk
            $imgDir = $GLOBALS['uploadsDir'] . DIRECTORY_SEPARATOR . $id;
            if (is_dir($imgDir)) {
                $files = glob($imgDir . DIRECTORY_SEPARATOR . '*');
                foreach ($files as $f) { @unlink($f); }
                @rmdir($imgDir);
            }
            array_splice($items, $idx, 1);
            write_json($dataFile, $items);
            echo json_encode([ 'ok' => true ]);
            break;
        }
        case 'upload_image': {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode([ 'ok' => false, 'error' => 'Method not allowed' ]); break; }
            $itemId = $_POST['item_id'] ?? null;
            if (!$itemId) { http_response_code(400); echo json_encode([ 'ok' => false, 'error' => 'Missing item_id' ]); break; }
            $items = read_json($dataFile);
            $idx = find_index_by_id($items, $itemId);
            if ($idx < 0) { http_response_code(404); echo json_encode([ 'ok' => false, 'error' => 'Item not found' ]); break; }
            if (!isset($_FILES['image'])) { http_response_code(400); echo json_encode([ 'ok' => false, 'error' => 'No image' ]); break; }
            $image = $_FILES['image'];
            $thumb = $_FILES['thumb'] ?? null;
            // Basic checks
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            $mime = finfo_file($finfo, $image['tmp_name']);
            finfo_close($finfo);
            if ($mime !== 'image/webp') { http_response_code(400); echo json_encode([ 'ok' => false, 'error' => 'Only WebP images allowed' ]); break; }
            $dir = $GLOBALS['uploadsDir'] . DIRECTORY_SEPARATOR . $itemId;
            if (!file_exists($dir)) { @mkdir($dir, 0775, true); }
            $base = basename($_FILES['image']['name']);
            $safe = preg_replace('/[^a-zA-Z0-9._-]/', '', $base);
            $lower = strtolower($safe);
            if (substr($lower, -5) !== '.webp') { $safe .= '.webp'; }
            $ts = time();
            $rand = bin2hex(random_bytes(4));
            $finalName = $ts . '-' . $rand . '-' . $safe;
            $target = $dir . DIRECTORY_SEPARATOR . $finalName;
            if (!move_uploaded_file($image['tmp_name'], $target)) { http_response_code(500); echo json_encode([ 'ok' => false, 'error' => 'Failed to save image' ]); break; }
            $thumbUrl = null;
            if ($thumb && is_uploaded_file($thumb['tmp_name'])) {
                $thumbBase = 'thumb-' . $finalName;
                $thumbTarget = $dir . DIRECTORY_SEPARATOR . $thumbBase;
                move_uploaded_file($thumb['tmp_name'], $thumbTarget);
                $thumbUrl = 'uploads/' . rawurlencode($itemId) . '/' . rawurlencode($thumbBase);
            }
            $url = 'uploads/' . rawurlencode($itemId) . '/' . rawurlencode($finalName);
            $meta = [
                'width' => intval($_POST['width'] ?? 0),
                'height' => intval($_POST['height'] ?? 0),
                'size' => intval($_POST['size'] ?? 0),
                'original_filename' => $_POST['original_filename'] ?? $finalName,
            ];
            $imageObj = [
                'url' => $url,
                'thumb_url' => $thumbUrl,
                'uploaded_at' => gmdate('c'),
                'taken_at' => $_POST['taken_at'] ?? null,
                'meta' => $meta,
            ];
            if (!isset($items[$idx]['images']) || !is_array($items[$idx]['images'])) { $items[$idx]['images'] = []; }
            $items[$idx]['images'][] = $imageObj;
            $items[$idx]['updated_at'] = gmdate('c');
            write_json($dataFile, $items);
            echo json_encode([ 'ok' => true, 'image' => $imageObj ]);
            break;
        }
        case 'delete_image': {
            $body = get_body_json();
            $itemId = $body['item_id'] ?? null;
            $url = $body['url'] ?? null;
            $thumbUrl = $body['thumb_url'] ?? null;
            if (!$itemId || !$url) { http_response_code(400); echo json_encode([ 'ok' => false, 'error' => 'Missing params' ]); break; }
            $items = read_json($dataFile);
            $idx = find_index_by_id($items, $itemId);
            if ($idx < 0) { http_response_code(404); echo json_encode([ 'ok' => false, 'error' => 'Item not found' ]); break; }
            $dir = $GLOBALS['uploadsDir'] . DIRECTORY_SEPARATOR . $itemId;
            $basename = basename(parse_url($url, PHP_URL_PATH));
            @unlink($dir . DIRECTORY_SEPARATOR . $basename);
            if ($thumbUrl) {
                $tbase = basename(parse_url($thumbUrl, PHP_URL_PATH));
                @unlink($dir . DIRECTORY_SEPARATOR . $tbase);
            }
            $imgs = $items[$idx]['images'] ?? [];
            $items[$idx]['images'] = array_values(array_filter($imgs, function ($i) use ($url) { return ($i['url'] ?? '') !== $url; }));
            $items[$idx]['updated_at'] = gmdate('c');
            write_json($dataFile, $items);
            echo json_encode([ 'ok' => true ]);
            break;
        }
        default: {
            http_response_code(400);
            echo json_encode([ 'ok' => false, 'error' => 'Unknown action' ]);
        }
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode([ 'ok' => false, 'error' => 'Server error', 'detail' => $e->getMessage() ]);
}


