<?php
// Fallback for Beget/Timeweb Russian hosting
header('Content-Type: application/json; charset=utf-8');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error'=>'method']); exit; }
$body = json_decode(file_get_contents('php://input'), true);
if (!$body) { http_response_code(400); echo json_encode(['error'=>'json']); exit; }

$name = trim($body['name'] ?? '');
$phone = trim($body['phone'] ?? '');
$vin = strtoupper(trim($body['vin'] ?? ''));
if (mb_strlen($name) < 2) { http_response_code(400); echo json_encode(['error'=>'name']); exit; }
if (strlen(preg_replace('/\D/','',$phone)) < 10) { http_response_code(400); echo json_encode(['error'=>'phone']); exit; }
if ($vin && !preg_match('/^[A-HJ-NPR-Z0-9]{17}$/', $vin)) { http_response_code(400); echo json_encode(['error'=>'vin']); exit; }
if (!empty($body['_trap'])) { http_response_code(400); echo json_encode(['error'=>'spam']); exit; }

// Save to file
$lead = $body; $lead['createdAt'] = date('c'); $lead['ip'] = $_SERVER['REMOTE_ADDR'] ?? '';
file_put_contents(__DIR__.'/../data/leads.json', json_encode($lead, JSON_UNESCAPED_UNICODE)."\n", FILE_APPEND);

// Email
$to = getenv('EMAIL_TO') ?: 'info@portovaya439.ru';
$subject = 'Новая заявка '.($body['id']??'').' — '.($body['brand']??'').' '.($body['model']??'');
$message = "Новая заявка\nАвто: ".($body['segment']??'')." ".($body['brand']??'')." ".($body['model']??'')." ".($body['year']??'')."\nVIN: ".($vin?:'—')."\nНеисправности: ".implode(', ', $body['faults']??[])."\nКлиент: $name $phone\n";
@mail($to, $subject, $message, "Content-Type: text/plain; charset=utf-8\r\nFrom: noreply@portovaya439.ru");

// Telegram
$token = getenv('TELEGRAM_BOT_TOKEN'); $chat = getenv('TELEGRAM_CHAT_ID');
if ($token && $chat) {
  $text = "🔧 Новая заявка ".($body['id']??'')."\nАвто: ".($body['segment']??'')." ".($body['brand']??'')." ".($body['model']??'')."\nVIN: ".($vin?:'—')."\nКлиент: $name $phone";
  @file_get_contents("https://api.telegram.org/bot$token/sendMessage?".http_build_query(['chat_id'=>$chat,'text'=>$text,'parse_mode'=>'HTML']));
}

echo json_encode(['ok'=>true, 'id'=>$body['id']??null]);
