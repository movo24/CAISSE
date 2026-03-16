import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConnectedAppsService } from './connected-apps.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('connected-apps')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('connected-apps')
export class ConnectedAppsController {
  constructor(private service: ConnectedAppsService) {}

  @Get()
  @ApiOperation({ summary: 'List connected apps for organization' })
  findAll(@Query('organizationId') organizationId: string) {
    return this.service.findAll(organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get connected app by ID' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Register a connected app' })
  create(@Body() body: Partial<any>) {
    return this.service.create(body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a connected app' })
  update(@Param('id') id: string, @Body() body: Partial<any>) {
    return this.service.update(id, body);
  }

  @Put(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate a connected app' })
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}
